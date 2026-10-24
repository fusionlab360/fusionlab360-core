import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import {
  CredentialRepository,
} from "../../../../src/persistence/repositories/credential-repository";

import {
  completePendingGHLLocationOnboarding,
  syncGHLKnownLocationCredentials,
} from "../../../../src/integrations/messaging/gohighlevel/credential-sync";

import {
  IntegrationRepository,
} from "../../../../src/persistence/repositories/integration-repository";

import {
  TenantRepository,
} from "../../../../src/persistence/repositories/tenant-repository";

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE integrations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, provider)
      );

      CREATE TABLE integration_credentials (
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        api_key TEXT,
        location_id TEXT,
        refresh_token TEXT,
        access_token_expires_at INTEGER,
        refresh_lock_token TEXT,
        refresh_lock_expires_at INTEGER,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, provider)
      );
    `);
  }
  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];

    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },

      run: async () => {
        const result = this.sqlite
          .prepare(sql)
          .run(...(bindings as never[]));

        return {
          meta: {
            changes: Number(result.changes),
          },
        };
      },

      first: async <T>() =>
        (
          this.sqlite
            .prepare(sql)
            .get(...(bindings as never[])) as
              | T
              | undefined
        ) ?? null,

      all: async <T>() => ({
        results: this.sqlite
          .prepare(sql)
          .all(...(bindings as never[]) as never[]) as T[],
      }),
    };

    return statement as unknown as D1PreparedStatement;
  }

  close(): void {
    this.sqlite.close();
  }
}

function seedPIT(
  db: SqliteD1Database,
  options: {
    tenantId: string;
    locationId: string;
    companyId: string;
    pit: string;
  },
): void {
  db.sqlite.prepare(`
    INSERT INTO integration_credentials (
      tenant_id,
      provider,
      auth_type,
      api_key,
      location_id,
      refresh_token,
      metadata
    )
    VALUES (?, 'gohighlevel', 'api_key', ?, ?, NULL, ?)
  `).run(
    options.tenantId,
    options.pit,
    options.locationId,
    JSON.stringify({
      accountType: "location",
      companyId: options.companyId,
      locationId: options.locationId,
    }),
  );
}

function seedPendingOAuth(
  db: SqliteD1Database,
): void {
  db.sqlite.prepare(`
    INSERT INTO tenants (id, name, status)
    VALUES ('fusionlab', 'FusionLab', 'inactive')
  `).run();

  db.sqlite.prepare(`
    INSERT INTO integrations (
      id, tenant_id, provider, enabled
    )
    VALUES (
      'fusionlab-ghl',
      'fusionlab',
      'gohighlevel',
      0
    )
  `).run();

  db.sqlite.prepare(`
    INSERT INTO integration_credentials (
      tenant_id,
      provider,
      auth_type,
      api_key,
      location_id,
      refresh_token,
      metadata
    )
    VALUES (?, 'gohighlevel', 'oauth2', ?, ?, ?, ?)
  `).run(
    "fusionlab",
    "new-access-token",
    "location-fusionlab",
    "new-refresh-token",
    JSON.stringify({
      accountType: "location",
      companyId: "company-fusionlab",
      locationId: "location-fusionlab",
      connectionStatus: "pending_oauth",
    }),
  );
}

test(
  "pending OAuth tenant activates only after its matching credential is stored",
  async () => {
    const db = new SqliteD1Database();

    try {
      seedPendingOAuth(db);

      await completePendingGHLLocationOnboarding(
        db as unknown as D1Database,
        "fusionlab",
        "company-fusionlab",
        "location-fusionlab",
      );

      // All three conditional transitions are safe to retry after a
      // partial callback failure.
      await completePendingGHLLocationOnboarding(
        db as unknown as D1Database,
        "fusionlab",
        "company-fusionlab",
        "location-fusionlab",
      );

      const tenant = db.sqlite.prepare(`
        SELECT status
        FROM tenants
        WHERE id = ?
      `).get("fusionlab") as {
        status: string;
      };

      const integration = db.sqlite.prepare(`
        SELECT enabled
        FROM integrations
        WHERE id = ?
      `).get("fusionlab-ghl") as {
        enabled: number;
      };

      const credential = db.sqlite.prepare(`
        SELECT auth_type, api_key, metadata
        FROM integration_credentials
        WHERE tenant_id = ?
          AND provider = ?
      `).get(
        "fusionlab",
        "gohighlevel",
      ) as {
        auth_type: string;
        api_key: string;
        metadata: string;
      };

      assert.equal(tenant.status, "active");
      assert.equal(integration.enabled, 1);
      assert.equal(credential.auth_type, "oauth2");
      assert.equal(credential.api_key, "new-access-token");
      assert.equal(
        JSON.parse(credential.metadata).connectionStatus,
        "connected",
      );
    } finally {
      db.close();
    }
  },
);

test(
  "pending OAuth tenant rejects a mismatched Company ID",
  async () => {
    const db = new SqliteD1Database();

    try {
      seedPendingOAuth(db);

      const integrationRepository =
        new IntegrationRepository(
          db as unknown as D1Database,
        );

      const tenantRepository =
        new TenantRepository(
          db as unknown as D1Database,
        );

      const credentialRepository =
        new CredentialRepository(
          db as unknown as D1Database,
        );

      const integrationEnabled =
        await integrationRepository.enablePendingOAuthIntegration(
          "fusionlab",
          "gohighlevel",
          "location-fusionlab",
          "wrong-company",
        );

      assert.equal(integrationEnabled, false);

      const tenantActivated =
        await tenantRepository.activatePendingOAuthTenant(
          "fusionlab",
          "gohighlevel",
          "location-fusionlab",
          "wrong-company",
        );

      assert.equal(tenantActivated, false);

      const credentialConnected =
        await credentialRepository.markPendingOAuthCredentialConnected(
          "fusionlab",
          "gohighlevel",
          "location-fusionlab",
          "wrong-company",
        );

      assert.equal(credentialConnected, false);

      const tenant = db.sqlite.prepare(`
        SELECT status
        FROM tenants
        WHERE id = ?
      `).get("fusionlab") as {
        status: string;
      };

      const integration = db.sqlite.prepare(`
        SELECT enabled
        FROM integrations
        WHERE id = ?
      `).get("fusionlab-ghl") as {
        enabled: number;
      };

      const credential = db.sqlite.prepare(`
        SELECT metadata
        FROM integration_credentials
        WHERE tenant_id = ?
          AND provider = ?
      `).get(
        "fusionlab",
        "gohighlevel",
      ) as {
        metadata: string;
      };

      assert.equal(tenant.status, "inactive");
      assert.equal(integration.enabled, 0);
      assert.equal(
        JSON.parse(credential.metadata).connectionStatus,
        "pending_oauth",
      );
    } finally {
      db.close();
    }
  },
);

test(
  "new OAuth credential is stored with auth_type oauth2",
  async () => {
    const db = new SqliteD1Database();

    try {
      const repository = new CredentialRepository(
        db as unknown as D1Database,
      );

      const result = await repository.upsertOAuthCredential(
        "tenant-oauth",
        "gohighlevel",
        "location-oauth",
        "access-token-one",
        "refresh-token-one",
        '{"companyId":"company-one"}',
        1_800_000_000_000,
      );

      assert.deepEqual(result, {
        status: "stored",
      });

      const credential =
        await repository.findByTenantAndProvider(
          "tenant-oauth",
          "gohighlevel",
        );

      assert.ok(credential);
      assert.equal(credential.authType, "oauth2");
      assert.equal(credential.apiKey, "access-token-one");
      assert.equal(credential.refreshToken, "refresh-token-one");
      assert.equal(credential.locationId, "location-oauth");
    } finally {
      db.close();
    }
  },
);

test(
  "OAuth reconnect updates access token but preserves an existing refresh token when none is returned",
  async () => {
    const db = new SqliteD1Database();

    try {
      const repository = new CredentialRepository(
        db as unknown as D1Database,
      );

      await repository.upsertOAuthCredential(
        "tenant-oauth",
        "gohighlevel",
        "location-oauth",
        "access-token-one",
        "refresh-token-one",
        '{"version":1}',
        1_800_000_000_000,
      );

      const result = await repository.upsertOAuthCredential(
        "tenant-oauth",
        "gohighlevel",
        "location-oauth",
        "access-token-two",
        null,
        '{"version":2}',
        1_810_000_000_000,
      );

      assert.deepEqual(result, {
        status: "stored",
      });

      const credential =
        await repository.findByTenantAndProvider(
          "tenant-oauth",
          "gohighlevel",
        );

      assert.ok(credential);
      assert.equal(credential.authType, "oauth2");
      assert.equal(credential.apiKey, "access-token-two");
      assert.equal(credential.refreshToken, "refresh-token-one");
      assert.equal(
        credential.accessTokenExpiresAt,
        1_810_000_000_000,
      );
    } finally {
      db.close();
    }
  },
);

test(
  "OAuth upsert reports skipped_legacy_pit and preserves the PIT unchanged",
  async () => {
    const db = new SqliteD1Database();

    try {
      seedPIT(db, {
        tenantId: "tenant-pit",
        locationId: "location-pit",
        companyId: "company-one",
        pit: "original-pit-value",
      });

      const repository = new CredentialRepository(
        db as unknown as D1Database,
      );

      const result = await repository.upsertOAuthCredential(
        "tenant-pit",
        "gohighlevel",
        "location-pit",
        "new-oauth-access-token",
        "new-oauth-refresh-token",
        '{"companyId":"company-one"}',
        1_800_000_000_000,
      );

      assert.deepEqual(result, {
        status: "skipped_legacy_pit",
      });

      const credential =
        await repository.findByTenantAndProvider(
          "tenant-pit",
          "gohighlevel",
        );

      assert.ok(credential);
      assert.equal(credential.authType, "api_key");
      assert.equal(credential.apiKey, "original-pit-value");
      assert.equal(credential.refreshToken, null);
      assert.equal(credential.locationId, "location-pit");
    } finally {
      db.close();
    }
  },
);

test(
  "company sync reports incomplete when an existing PIT is preserved",
  async () => {
    const db = new SqliteD1Database();

    try {
      seedPIT(db, {
        tenantId: "tenant-pit",
        locationId: "location-pit",
        companyId: "company-one",
        pit: "original-pit-value",
      });

      const result =
        await syncGHLKnownLocationCredentials(
          db as unknown as D1Database,
          {} as never,
          "company-one",
        );

      assert.equal(result.success, false);
      assert.equal(result.status, "incomplete");
      assert.equal(result.locationsFound, 1);

      assert.deepEqual(result.results, [
        {
          locationId: "location-pit",
          success: false,
          status: "skipped_legacy_pit",
          error: "legacy_pit_preserved",
        },
      ]);

      const credential = db.sqlite.prepare(`
        SELECT auth_type, api_key, refresh_token
        FROM integration_credentials
        WHERE tenant_id = ?
          AND provider = ?
      `).get(
        "tenant-pit",
        "gohighlevel",
      ) as {
        auth_type: string;
        api_key: string;
        refresh_token: string | null;
      };

      assert.equal(credential.auth_type, "api_key");
      assert.equal(credential.api_key, "original-pit-value");
      assert.equal(credential.refresh_token, null);
    } finally {
      db.close();
    }
  },
);

test(
  "company sync does not report success when no Location mappings exist",
  async () => {
    const db = new SqliteD1Database();

    try {
      const result =
        await syncGHLKnownLocationCredentials(
          db as unknown as D1Database,
          {} as never,
          "company-with-no-locations",
        );

      assert.equal(result.success, false);
      assert.equal(result.status, "no_locations");
      assert.equal(result.locationsFound, 0);
      assert.deepEqual(result.results, []);
    } finally {
      db.close();
    }
  },
);

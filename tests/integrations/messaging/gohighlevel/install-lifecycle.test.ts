import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import {
  isGHLUninstallEvent,
  processGHLUninstall,
} from "../../../../src/integrations/messaging/gohighlevel/install";
import {
  GHLIntegrationCredentialResolver,
} from "../../../../src/integrations/gohighlevel/credential-runtime";

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE integrations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        settings TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, provider)
      );
      CREATE TABLE integration_credentials (
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        auth_type TEXT NOT NULL,
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
      run: async () => ({
        meta: {
          changes: Number(this.sqlite.prepare(sql).run(...bindings as never[]).changes),
        },
      }),
      first: async <T>() => (
        (this.sqlite.prepare(sql).get(...bindings as never[]) as T | undefined) ?? null
      ),
      all: async <T>() => ({
        results: this.sqlite.prepare(sql).all(...bindings as never[]) as T[],
      }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  close(): void {
    this.sqlite.close();
  }
}

function seedTenant(
  db: SqliteD1Database,
  tenantId: string,
  locationId: string,
  companyId: string,
): void {
  db.sqlite.prepare(`
    INSERT INTO integrations (id, tenant_id, provider, enabled, settings)
    VALUES (?, ?, 'gohighlevel', 1, '{"keep":true}')
  `).run(`${tenantId}-ghl`, tenantId);
  db.sqlite.prepare(`
    INSERT INTO integration_credentials (
      tenant_id, provider, auth_type, api_key, location_id,
      refresh_token, metadata
    ) VALUES (?, 'gohighlevel', 'oauth2', ?, ?, ?, ?)
  `).run(
    tenantId,
    `${tenantId}-access-token`,
    locationId,
    `${tenantId}-refresh-token`,
    JSON.stringify({ accountType: "location", companyId, locationId, keep: "value" }),
  );
}

test("GHL uninstall disconnects only the matching location and is idempotent", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a", "location-a", "company-a");
    seedTenant(db, "tenant-b", "location-b", "company-b");

    const first = await processGHLUninstall(db as unknown as D1Database, {
      type: "UNINSTALL",
      locationId: "location-a",
      companyId: "company-a",
    });
    assert.equal(first.status, "disconnected");
    assert.equal(first.credentialChanged, true);
    assert.equal(first.integrationChanged, true);

    const credential = db.sqlite.prepare(`
      SELECT api_key, refresh_token, metadata
      FROM integration_credentials
      WHERE tenant_id = 'tenant-a'
    `).get() as { api_key: string; refresh_token: string; metadata: string };
    assert.equal(credential.api_key, "tenant-a-access-token");
    assert.equal(credential.refresh_token, "tenant-a-refresh-token");
    assert.deepEqual(JSON.parse(credential.metadata), {
      accountType: "location",
      companyId: "company-a",
      locationId: "location-a",
      keep: "value",
      connectionStatus: "disconnected",
      oauthRecoveryStatus: "reauthorization_required",
      oauthRecoveryReason: "uninstalled",
      oauthDisconnectedAt: JSON.parse(credential.metadata).oauthDisconnectedAt,
    });
    assert.equal(
      (db.sqlite.prepare("SELECT enabled FROM integrations WHERE tenant_id = 'tenant-a'").get() as { enabled: number }).enabled,
      0,
    );
    assert.equal(
      (db.sqlite.prepare("SELECT enabled FROM integrations WHERE tenant_id = 'tenant-b'").get() as { enabled: number }).enabled,
      1,
    );

    const duplicate = await processGHLUninstall(db as unknown as D1Database, {
      type: "APP_UNINSTALL",
      locationId: "location-a",
      companyId: "company-a",
    });
    assert.equal(duplicate.status, "disconnected");
    assert.equal(duplicate.credentialChanged, false);
    assert.equal(duplicate.integrationChanged, false);
  } finally {
    db.close();
  }
});

test("GHL uninstall rejects a mismatched company and unknown location", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a", "location-a", "company-a");

    const mismatch = await processGHLUninstall(db as unknown as D1Database, {
      type: "UNINSTALL",
      locationId: "location-a",
      companyId: "other-company",
    });
    assert.equal(mismatch.status, "ignored");
    assert.equal(mismatch.reason, "company_mismatch");
    assert.equal(
      (db.sqlite.prepare("SELECT enabled FROM integrations WHERE tenant_id = 'tenant-a'").get() as { enabled: number }).enabled,
      1,
    );

    const unknown = await processGHLUninstall(db as unknown as D1Database, {
      type: "UNINSTALL",
      locationId: "unknown-location",
      companyId: "company-a",
    });
    assert.equal(unknown.status, "ignored");
    assert.equal(unknown.reason, "unknown_location");
  } finally {
    db.close();
  }
});

test("location-less uninstall is fail-closed and event aliases are explicit", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a", "location-a", "company-a");
    const result = await processGHLUninstall(db as unknown as D1Database, {
      type: "UNINSTALL",
      companyId: "company-a",
    });
    assert.equal(result.status, "ignored");
    assert.equal(result.reason, "missing_location");
  } finally {
    db.close();
  }

  assert.equal(isGHLUninstallEvent("UNINSTALL"), true);
  assert.equal(isGHLUninstallEvent("APP-UNINSTALL"), true);
  assert.equal(isGHLUninstallEvent("UPDATE"), false);
});

test("disconnected GHL OAuth credentials are blocked until reauthorization", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a", "location-a", "company-a");
    db.sqlite.prepare(`
      UPDATE integration_credentials
      SET metadata = ?
      WHERE tenant_id = 'tenant-a'
    `).run(JSON.stringify({
      connectionStatus: "disconnected",
      oauthRecoveryReason: "uninstalled",
    }));

    const resolver = new GHLIntegrationCredentialResolver(
      db as unknown as D1Database,
      {
        GHL_OAUTH_CLIENT_ID: "test-client",
        GHL_OAUTH_CLIENT_SECRET: "test-secret",
      },
    );

    await assert.rejects(
      resolver.resolve({
        tenantId: "tenant-a",
        provider: "gohighlevel",
        resourceId: "location-a",
      }),
      /requires reauthorization/i,
    );
  } finally {
    db.close();
  }
});

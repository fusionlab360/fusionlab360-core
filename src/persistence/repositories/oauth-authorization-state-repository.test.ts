import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import {
  createOAuthStateToken,
  hashOAuthStateToken,
} from "../../core/security/oauth-state";

import {
  OAuthAuthorizationStateRepository,
} from "./oauth-authorization-state-repository";

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

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
          .run(...bindings as never[]);

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
            .get(...bindings as never[]) as T | undefined
        ) ?? null,
    };

    return statement as unknown as D1PreparedStatement;
  }
}

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  const migrationFiles = readdirSync(
    join(process.cwd(), "migrations"),
  )
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of migrationFiles) {
    database.sqlite.exec(
      readFileSync(
        join(process.cwd(), "migrations", filename),
        "utf8",
      ),
    );
  }

  database.sqlite.prepare(
    `
      INSERT INTO tenants (id, name, status)
      VALUES (?, ?, ?)
    `,
  ).run("oauth-test-tenant", "OAuth Test Tenant", "active");

  database.sqlite.prepare(
    `
      INSERT INTO tenants (id, name, status)
      VALUES (?, ?, ?)
    `,
  ).run("oauth-other-tenant", "Other Tenant", "active");

  database.sqlite.prepare(
    `
      INSERT INTO integrations (
        id, tenant_id, provider, enabled
      )
      VALUES (?, ?, ?, ?)
    `,
  ).run(
    "oauth-test-integration",
    "oauth-test-tenant",
    "example-provider",
    0,
  );

  return database;
}

test("OAuth state tokens are random and stored as SHA-256 hashes", async () => {
  const first = createOAuthStateToken();
  const second = createOAuthStateToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);

  const hash = await hashOAuthStateToken(first);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, first);
  assert.equal(hash, await hashOAuthStateToken(first));
});

test("OAuth state can be consumed once and returns its generic context", async () => {
  const database = createDatabase();

  try {
    const repository = new OAuthAuthorizationStateRepository(
      database as unknown as D1Database,
    );

    const rawState = createOAuthStateToken();
    const stateHash = await hashOAuthStateToken(rawState);
    const expiresAt = Date.now() + 5 * 60 * 1000;

    await repository.create({
      stateHash,
      tenantId: "oauth-test-tenant",
      integrationId: "oauth-test-integration",
      provider: "example-provider",
      purpose: "connect",
      context: {
        externalAccountId: "account-123",
        selectedResource: "resource-456",
      },
      expiresAt,
    });

    const stored = database.sqlite.prepare(
      `
        SELECT state_hash
        FROM oauth_authorization_states
        WHERE state_hash = ?
      `,
    ).get(stateHash) as { state_hash: string } | undefined;

    assert.ok(stored);
    assert.notEqual(stored.state_hash, rawState);

    const consumed = await repository.consume(stateHash);

    assert.ok(consumed);
    assert.equal(consumed.tenantId, "oauth-test-tenant");
    assert.equal(
      consumed.integrationId,
      "oauth-test-integration",
    );
    assert.equal(consumed.provider, "example-provider");
    assert.equal(consumed.purpose, "connect");
    assert.deepEqual(consumed.context, {
      externalAccountId: "account-123",
      selectedResource: "resource-456",
    });

    assert.equal(
      await repository.consume(stateHash),
      null,
      "A replayed state must be rejected.",
    );
  } finally {
    database.sqlite.close();
  }
});

test("expired and unknown OAuth state cannot be consumed", async () => {
  const database = createDatabase();

  try {
    const repository = new OAuthAuthorizationStateRepository(
      database as unknown as D1Database,
    );

    const rawState = createOAuthStateToken();
    const stateHash = await hashOAuthStateToken(rawState);
    const now = Date.now();

    // Insert a state that was valid when created but is now expired.
    database.sqlite.prepare(
      `
        INSERT INTO oauth_authorization_states (
          state_hash,
          tenant_id,
          integration_id,
          provider,
          purpose,
          context_json,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      stateHash,
      "oauth-test-tenant",
      "oauth-test-integration",
      "example-provider",
      "connect",
      "{}",
      now - 1000,
    );

    assert.equal(
      await repository.consume(stateHash, now),
      null,
    );

    const unknownHash = await hashOAuthStateToken(
      createOAuthStateToken(),
    );

    assert.equal(
      await repository.consume(unknownHash, now),
      null,
    );
  } finally {
    database.sqlite.close();
  }
});

test("state creation rejects an integration owned by another tenant", async () => {
  const database = createDatabase();

  try {
    const repository = new OAuthAuthorizationStateRepository(
      database as unknown as D1Database,
    );

    const stateHash = await hashOAuthStateToken(
      createOAuthStateToken(),
    );

    await assert.rejects(
      repository.create({
        stateHash,
        tenantId: "oauth-other-tenant",
        integrationId: "oauth-test-integration",
        provider: "example-provider",
        expiresAt: Date.now() + 60_000,
      }),
      /matching tenant integration/i,
    );

    const count = database.sqlite.prepare(
      `
        SELECT COUNT(*) AS total
        FROM oauth_authorization_states
      `,
    ).get() as { total: number };

    assert.equal(count.total, 0);
  } finally {
    database.sqlite.close();
  }
});
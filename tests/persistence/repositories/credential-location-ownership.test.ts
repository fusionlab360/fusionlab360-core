import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { CredentialRepository } from "../../../src/persistence/repositories/credential-repository";
import { resolveTenantByProviderLocation } from "../../../src/tenants/service";
import { buildInsertPendingOAuthCredentialSql } from "../../../src/cli/sql/insert-credentials";
import { createTenant } from "../../../src/cli/services/tenant-service";
import {
  completePendingGHLLocationOnboarding,
  syncGHLLocationCredential,
} from "../../../src/integrations/messaging/gohighlevel/credential-sync";

const ownershipMigration = "0027_enforce_ghl_location_ownership.sql";
const oauthEnvironment = {
  GHL_OAUTH_CLIENT_ID: "synthetic-client",
  GHL_OAUTH_CLIENT_SECRET: "synthetic-secret",
};

// Same SQLite-backed D1 boundary used by the existing OAuth onboarding tests.
class SqliteD1Database {
  readonly sqlite: DatabaseSync;
  constructor(withOwnershipIndex = true, path = ":memory:") {
    this.sqlite = new DatabaseSync(path);
    for (const file of readdirSync("migrations").filter((file) => file.endsWith(".sql")).sort()) {
      if (file !== ownershipMigration || withOwnershipIndex) {
        this.sqlite.exec(readFileSync(join("migrations", file), "utf8"));
      }
    }
  }
  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => { bindings = values; return statement; },
      run: async () => {
        const result = this.sqlite.prepare(sql).run(...bindings as never[]);
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (this.sqlite.prepare(sql).get(...bindings as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...bindings as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }
  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}

function seedTenant(db: SqliteD1Database, tenantId: string): void {
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'inactive')")
    .run(tenantId, "Synthetic tenant");
}

function seedOwner(db: SqliteD1Database, tenantId: string, locationId = "location-test", token: string | null = null): void {
  seedTenant(db, tenantId);
  db.sqlite.prepare(`INSERT INTO integration_credentials
    (tenant_id, provider, auth_type, api_key, location_id, refresh_token, metadata)
    VALUES (?, 'gohighlevel', 'oauth2', ?, ?, 'synthetic-refresh', ?)`)
    .run(tenantId, token, locationId, JSON.stringify({
      accountType: "location", companyId: "company-test", locationId,
      connectionStatus: token ? "connected" : "pending_oauth",
    }));
}

test("unique pending and connected Location ownership resolves; blank and unknown IDs fail safely", async () => {
  const db = new SqliteD1Database();
  try {
    seedOwner(db, "tenant-pending");
    seedOwner(db, "tenant-connected", "location-connected", "synthetic-token");
    const repository = new CredentialRepository(db.binding());
    assert.equal(await repository.findTenantIdByProviderAndLocation("gohighlevel", " location-test "), "tenant-pending");
    assert.equal(await repository.findTenantIdByProviderAndLocation("gohighlevel", "location-connected"), "tenant-connected");
    assert.equal(await repository.findTenantIdByProviderAndLocation("gohighlevel", "unknown"), null);
    await assert.rejects(repository.findTenantIdByProviderAndLocation("gohighlevel", " "), /identifier is required/);
  } finally { db.close(); }
});

test("legacy duplicate ownership rejects actual inbound resolution, synchronization and activation before provider calls", async () => {
  const db = new SqliteD1Database(false);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("Unexpected provider request"); };
  try {
    seedOwner(db, "tenant-first");
    seedOwner(db, "tenant-second", " location-test ", "synthetic-token");
    await assert.rejects(resolveTenantByProviderLocation(db.binding(), "gohighlevel", "location-test"), /ownership is ambiguous/);
    await assert.rejects(syncGHLLocationCredential(db.binding(), oauthEnvironment, "company-test", "location-test"), /ownership is ambiguous/);
    await assert.rejects(completePendingGHLLocationOnboarding(db.binding(), "tenant-first", "company-test", "location-test"), /ownership is ambiguous/);
    assert.equal(providerCalls, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants WHERE id IN ('tenant-first', 'tenant-second') AND status = 'inactive'").get()?.count, 2);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});

test("OAuth writes cannot steal a pending or connected Location; refresh tokens remain intact", async () => {
  for (const token of [null, "synthetic-token"]) {
    const db = new SqliteD1Database(false);
    try {
      seedOwner(db, "tenant-owner", "location-test", token);
      seedTenant(db, "tenant-other");
      const repository = new CredentialRepository(db.binding());
      await assert.rejects(repository.upsertOAuthCredential("tenant-other", "gohighlevel", "location-test", "new-token", "new-refresh", null), /already assigned/);
      assert.equal((await repository.findByTenantAndProvider("tenant-owner", "gohighlevel"))?.refreshToken, "synthetic-refresh");
      assert.equal(await repository.findByTenantAndProvider("tenant-other", "gohighlevel"), null);
      const result = await repository.upsertOAuthCredential("tenant-owner", "gohighlevel", "location-test", "updated-token", null, null);
      assert.equal(result.status, "stored");
      assert.equal((await repository.findByTenantAndProvider("tenant-owner", "gohighlevel"))?.refreshToken, "synthetic-refresh");
      await assert.rejects(syncGHLLocationCredential(db.binding(), oauthEnvironment, "company-test", "location-test", undefined, { expectedTenantId: "tenant-other" }), /no longer maps/);
    } finally { db.close(); }
  }
});

test("overlapping OAuth assignments cannot both succeed even before the ownership migration", async () => {
  const db = new SqliteD1Database(false);
  try {
    seedTenant(db, "tenant-a");
    seedTenant(db, "tenant-b");
    const repository = new CredentialRepository(db.binding());
    const outcomes = await Promise.allSettled(["tenant-a", "tenant-b"].map((tenantId) =>
      repository.upsertOAuthCredential(tenantId, "gohighlevel", "location-race", "synthetic-token", null, null)));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE location_id = 'location-race'").get()?.count, 1);
  } finally { db.close(); }
});

test("tenant provisioning rejects a claimed Location and the index prevents ownership-changing updates", async () => {
  const db = new SqliteD1Database();
  try {
    seedOwner(db, "tenant-owner", "location-test", "synthetic-token");
    const pendingTenant = await createTenant({
      tenantId: "tenant-new", tenantName: "Synthetic pending tenant", provider: "gohighlevel",
      companyId: "company-test", locationId: " location-test ", permissions: ["integrations:oauth:connect"],
    });
    assert.throws(() => db.sqlite.exec(pendingTenant.sql), /UNIQUE constraint failed/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE TRIM(location_id) = 'location-test'").get()?.count, 1);
    seedOwner(db, "tenant-other", "location-other");
    assert.throws(() => db.sqlite.exec("UPDATE integration_credentials SET location_id = 'location-test' WHERE tenant_id = 'tenant-other'"), /UNIQUE constraint failed/);
    // The ownership rule is GHL-specific; another provider retains its existing contract.
    db.sqlite.exec("INSERT INTO integration_credentials (tenant_id, provider, location_id) VALUES ('tenant-other', 'other-provider', 'location-test')");
  } finally { db.close(); }
});

test("the proposed migration fails on normalized legacy duplicates without modifying credentials", () => {
  const db = new SqliteD1Database(false);
  try {
    seedOwner(db, "tenant-first", "location-test", "synthetic-first");
    seedOwner(db, "tenant-second", " location-test ", "synthetic-second");
    assert.throws(() => db.sqlite.exec(readFileSync(join("migrations", ownershipMigration), "utf8")), /UNIQUE constraint failed/);
    assert.deepEqual(db.sqlite.prepare("SELECT api_key FROM integration_credentials WHERE TRIM(location_id) = 'location-test' ORDER BY tenant_id").all().map((row) => row.api_key), ["synthetic-first", "synthetic-second"]);
  } finally { db.close(); }
});

test("simultaneous pending provisioning on independent SQLite connections has exactly one owner", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "fusion-location-ownership-"));
  const path = join(directory, "local.sqlite");
  const db = new SqliteD1Database(true, path);
  const workers: Worker[] = [];
  try {
    seedTenant(db, "tenant-a");
    seedTenant(db, "tenant-b");
    const ready: Promise<void>[] = [];
    const results = ["tenant-a", "tenant-b"].map((tenantId) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(workerData.path);
        db.exec('PRAGMA busy_timeout = 5000');
        parentPort.once('message', () => {
          try { db.exec(workerData.sql); parentPort.postMessage('stored'); }
          catch (error) { parentPort.postMessage(error.message); }
          finally { db.close(); parentPort.close(); }
        });
        parentPort.postMessage('ready');
      `, { eval: true, workerData: { path, sql: buildInsertPendingOAuthCredentialSql({ tenantId, provider: "gohighlevel", companyId: "company-test", locationId: "location-race" }) } });
      workers.push(worker);
      ready.push(new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); }));
      return new Promise<string>((resolve, reject) => { worker.on("message", (result: string) => { if (result !== "ready") resolve(result); }); worker.once("error", reject); });
    });
    await Promise.all(ready);
    workers.forEach((worker) => worker.postMessage("start"));
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter((outcome) => outcome === "stored").length, 1);
    assert.equal(outcomes.filter((outcome) => /UNIQUE constraint failed/.test(outcome)).length, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE location_id = 'location-race'").get()?.count, 1);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    db.close();
    unlinkSync(path);
    rmdirSync(directory);
  }
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { CredentialCipher, CredentialCipherError } from "../../../src/core/security/encrypted-credential";
import type { CredentialStorageConfiguration } from "../../../src/core/security/credential-storage";
import { CredentialRepository } from "../../../src/persistence/repositories/credential-repository";
import { OAuthInstallationRepository } from "../../../src/persistence/repositories/oauth-installation-repository";

const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(23)));
const cipher = CredentialCipher.fromConfiguration({
  keyring: JSON.stringify({ "synthetic-v1": testKey }),
  activeKeyVersion: "synthetic-v1",
});
const secureStorage: CredentialStorageConfiguration = {
  cipher,
  allowLegacyPlaintextReads: true,
};
const noLegacyReads: CredentialStorageConfiguration = {
  cipher,
  allowLegacyPlaintextReads: false,
};

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join("migrations", file), "utf8"));
    }
    // Migration 0005 includes a historical sample GHL credential; this suite
    // seeds only synthetic rows so migration batch counts remain deterministic.
    this.sqlite.exec("DELETE FROM integration_credentials; DELETE FROM oauth_installations;");
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

  binding(): D1Database {
    return this as unknown as D1Database;
  }

  close(): void {
    this.sqlite.close();
  }
}

function seedTenant(db: SqliteD1Database, tenantId: string): void {
  db.sqlite.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(tenantId, `Synthetic ${tenantId}`);
}

function seedLocationCredential(
  db: SqliteD1Database,
  tenantId: string,
  locationId: string,
  apiKey = "legacy-access-token",
  refreshToken: string | null = "legacy-refresh-token",
): void {
  seedTenant(db, tenantId);
  db.sqlite.prepare(`
    INSERT INTO integration_credentials
      (tenant_id, provider, auth_type, api_key, location_id, refresh_token, metadata)
    VALUES (?, 'gohighlevel', 'oauth2', ?, ?, ?, '{}')
  `).run(tenantId, apiKey, locationId, refreshToken);
}

function seedCompanyInstallation(db: SqliteD1Database, companyId: string): void {
  db.sqlite.prepare(`
    INSERT INTO oauth_installations
      (provider, account_type, external_account_id, access_token, refresh_token, metadata)
    VALUES ('gohighlevel', 'company', ?, 'legacy-company-access', 'legacy-company-refresh', '{}')
  `).run(companyId);
}

test("new location OAuth credentials are encrypted and tenant aggregates omit GHL token material", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a");
    const repository = new CredentialRepository(db.binding(), noLegacyReads);
    const result = await repository.upsertOAuthCredential(
      "tenant-a", "gohighlevel", "location-a", "synthetic-access", "synthetic-refresh", "{}", Date.now() + 60_000,
    );
    assert.deepEqual(result, { status: "stored" });

    const stored = db.sqlite.prepare(`
      SELECT api_key, refresh_token FROM integration_credentials
      WHERE tenant_id = 'tenant-a' AND provider = 'gohighlevel'
    `).get() as { api_key: string; refresh_token: string };
    assert.match(stored.api_key, /^fl360enc:v1:synthetic-v1:/);
    assert.match(stored.refresh_token, /^fl360enc:v1:synthetic-v1:/);
    assert.equal(stored.api_key.includes("synthetic-access"), false);
    const loaded = await repository.findByTenantAndProvider("tenant-a", "gohighlevel");
    assert.equal(loaded?.apiKey, "synthetic-access");
    assert.equal(loaded?.refreshToken, "synthetic-refresh");
    const tenantAggregate = await repository.findByTenant("tenant-a");
    assert.equal(tenantAggregate[0]?.apiKey, "");
    assert.equal(tenantAggregate[0]?.refreshToken, null);
  } finally {
    db.close();
  }
});

test("legacy plaintext reads require the explicit compatibility switch and encrypted reads require keys", async () => {
  const db = new SqliteD1Database();
  try {
    seedLocationCredential(db, "tenant-a", "location-a");
    const disabled = new CredentialRepository(db.binding(), noLegacyReads);
    await assert.rejects(
      disabled.findByTenantAndProvider("tenant-a", "gohighlevel"),
      CredentialCipherError,
    );

    const enabled = new CredentialRepository(db.binding(), secureStorage);
    const credential = await enabled.findByTenantAndProvider("tenant-a", "gohighlevel");
    assert.equal(credential?.apiKey, "legacy-access-token");
    assert.equal(credential?.refreshToken, "legacy-refresh-token");

    const ciphered = await encryptForTest("tenant-a", "location-a", "synthetic-encrypted-token");
    db.sqlite.prepare("UPDATE integration_credentials SET api_key = ? WHERE tenant_id = 'tenant-a'").run(ciphered);
    const missingKeyReader = new CredentialRepository(db.binding(), { allowLegacyPlaintextReads: true });
    await assert.rejects(
      missingKeyReader.findByTenantAndProvider("tenant-a", "gohighlevel"),
      /keys are required/,
    );
  } finally {
    db.close();
  }
});

async function encryptForTest(tenantId: string, locationId: string, value: string): Promise<string> {
  const { encryptCredentialValue, integrationCredentialContext } = await import("../../../src/core/security/credential-storage");
  return (await encryptCredentialValue(
    cipher,
    integrationCredentialContext(tenantId, "gohighlevel", locationId, "access"),
    value,
  )) ?? "";
}

test("location credentials are bound to tenant and location; wrong keys and corruption fail closed", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a");
    const writer = new CredentialRepository(db.binding(), noLegacyReads);
    await writer.upsertOAuthCredential("tenant-a", "gohighlevel", "location-a", "tenant-a-token", "tenant-a-refresh", "{}", Date.now() + 60_000);
    const row = db.sqlite.prepare("SELECT api_key, refresh_token FROM integration_credentials WHERE tenant_id='tenant-a'").get() as { api_key: string; refresh_token: string };

    seedLocationCredential(db, "tenant-b", "location-b", row.api_key, row.refresh_token);
    const reader = new CredentialRepository(db.binding(), noLegacyReads);
    await assert.rejects(reader.findByTenantAndProvider("tenant-b", "gohighlevel"), /could not be authenticated/);

    const wrongCipher = CredentialCipher.fromConfiguration({
      keyring: JSON.stringify({ "synthetic-v1": btoa(String.fromCharCode(...new Uint8Array(32).fill(24))) }),
      activeKeyVersion: "synthetic-v1",
    });
    await assert.rejects(
      new CredentialRepository(db.binding(), { cipher: wrongCipher, allowLegacyPlaintextReads: false })
        .findByTenantAndProvider("tenant-a", "gohighlevel"),
      /could not be authenticated/,
    );

    db.sqlite.prepare("UPDATE integration_credentials SET api_key = api_key || 'x' WHERE tenant_id='tenant-a'").run();
    await assert.rejects(reader.findByTenantAndProvider("tenant-a", "gohighlevel"), CredentialCipherError);
  } finally {
    db.close();
  }
});

test("location refresh locks serialize token rotation and both rotated fields remain encrypted", async () => {
  const db = new SqliteD1Database();
  try {
    seedLocationCredential(db, "tenant-a", "location-a", "old-access", "old-refresh");
    const repository = new CredentialRepository(db.binding(), secureStorage);
    const now = Date.now();
    assert.equal(await repository.acquireOAuthRefreshLock("tenant-a", "gohighlevel", "lock-a", now, now + 60_000), true);
    assert.equal(await repository.acquireOAuthRefreshLock("tenant-a", "gohighlevel", "lock-b", now, now + 60_000), false);
    assert.equal(await repository.saveRefreshedOAuthCredential("tenant-a", "gohighlevel", "lock-b", "wrong-access", "wrong-refresh", now + 120_000, "{}"), false);
    assert.equal(await repository.saveRefreshedOAuthCredential("tenant-a", "gohighlevel", "lock-a", "rotated-access", "rotated-refresh", now + 120_000, "{}"), true);

    const row = db.sqlite.prepare("SELECT api_key, refresh_token, refresh_lock_token FROM integration_credentials WHERE tenant_id='tenant-a'").get() as { api_key: string; refresh_token: string; refresh_lock_token: string | null };
    assert.match(row.api_key, /^fl360enc:v1:/);
    assert.match(row.refresh_token, /^fl360enc:v1:/);
    assert.equal(row.refresh_lock_token, null);
    const refreshed = await repository.findByTenantAndProvider("tenant-a", "gohighlevel");
    assert.equal(refreshed?.apiKey, "rotated-access");
    assert.equal(refreshed?.refreshToken, "rotated-refresh");
  } finally {
    db.close();
  }
});

test("company OAuth installations encrypt writes and safely preserve refresh-token rotation under the refresh lock", async () => {
  const db = new SqliteD1Database();
  try {
    const repository = new OAuthInstallationRepository(db.binding(), secureStorage);
    await repository.upsert({
      provider: "gohighlevel", accountType: "company", externalAccountId: "company-a",
      accessToken: "company-access", refreshToken: "company-refresh", metadata: "{}",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const stored = db.sqlite.prepare("SELECT access_token, refresh_token FROM oauth_installations WHERE external_account_id='company-a'").get() as { access_token: string; refresh_token: string };
    assert.match(stored.access_token, /^fl360enc:v1:/);
    assert.match(stored.refresh_token, /^fl360enc:v1:/);
    assert.equal((await repository.find("gohighlevel", "company", "company-a"))?.accessToken, "company-access");

    const now = Date.now();
    assert.equal(await repository.acquireRefreshLock("gohighlevel", "company", "company-a", "company-lock", now, now + 60_000), true);
    assert.equal(await repository.saveRefreshedToken("gohighlevel", "company", "company-a", "wrong-lock", "bad", "bad", now + 90_000, "{}"), false);
    assert.equal(await repository.saveRefreshedToken("gohighlevel", "company", "company-a", "company-lock", "company-access-rotated", "company-refresh-rotated", now + 90_000, "{}"), true);
    const refreshed = await repository.find("gohighlevel", "company", "company-a");
    assert.equal(refreshed?.accessToken, "company-access-rotated");
    assert.equal(refreshed?.refreshToken, "company-refresh-rotated");

    const secondCompany = await repository.createIfAbsent({
      provider: "gohighlevel", accountType: "company", externalAccountId: "company-b",
      accessToken: "company-b-access", refreshToken: "company-b-refresh", metadata: "{}",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    assert.equal(secondCompany, true);
    const storedB = db.sqlite.prepare("SELECT access_token FROM oauth_installations WHERE external_account_id='company-b'").get() as { access_token: string };
    db.sqlite.prepare("UPDATE oauth_installations SET access_token=? WHERE external_account_id='company-b'").run(stored.access_token);
    await assert.rejects(repository.find("gohighlevel", "company", "company-b"), /could not be authenticated/);
    assert.match(storedB.access_token, /^fl360enc:v1:/);
  } finally {
    db.close();
  }
});

test("plaintext credential batches are bounded, resumable, idempotent, and do not rewrite other providers", async () => {
  const db = new SqliteD1Database();
  try {
    seedLocationCredential(db, "tenant-a", "location-a");
    seedLocationCredential(db, "tenant-b", "location-b", "legacy-b-access", "legacy-b-refresh");
    seedTenant(db, "tenant-other");
    db.sqlite.prepare("INSERT INTO integration_credentials (tenant_id, provider, api_key) VALUES ('tenant-other','other-provider','other-plaintext')").run();
    seedCompanyInstallation(db, "company-a");
    const credentials = new CredentialRepository(db.binding(), noLegacyReads);
    const installations = new OAuthInstallationRepository(db.binding(), noLegacyReads);

    assert.equal(await credentials.migratePlaintextBatch(1), 1);
    assert.equal(await installations.migratePlaintextBatch(1), 1);
    assert.equal(await credentials.migratePlaintextBatch(1), 1);
    assert.equal(await credentials.migratePlaintextBatch(1), 0);
    assert.equal(await installations.migratePlaintextBatch(1), 0);

    const migrated = await credentials.findByTenantAndProvider("tenant-a", "gohighlevel");
    assert.equal(migrated?.apiKey, "legacy-access-token");
    assert.equal(migrated?.refreshToken, "legacy-refresh-token");
    assert.equal((db.sqlite.prepare("SELECT api_key FROM integration_credentials WHERE tenant_id='tenant-other'").get() as { api_key: string }).api_key, "other-plaintext");
    const migratedCompany = await installations.find("gohighlevel", "company", "company-a");
    assert.equal(migratedCompany?.accessToken, "legacy-company-access");
    assert.equal(migratedCompany?.refreshToken, "legacy-company-refresh");
  } finally {
    db.close();
  }
});

test("GHL credential writes fail closed when the encryption keyring is missing", async () => {
  const db = new SqliteD1Database();
  try {
    seedTenant(db, "tenant-a");
    const repository = new CredentialRepository(db.binding());
    await assert.rejects(
      repository.upsertOAuthCredential("tenant-a", "gohighlevel", "location-a", "synthetic-access", "synthetic-refresh", "{}"),
      /encryption must be configured/,
    );
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE tenant_id='tenant-a'").get()?.count, 0);

    const installations = new OAuthInstallationRepository(db.binding());
    await assert.rejects(installations.createIfAbsent({
      provider: "gohighlevel", accountType: "company", externalAccountId: "company-a",
      accessToken: "synthetic-company-access", refreshToken: "synthetic-company-refresh", metadata: "{}",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }), /encryption must be configured/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_installations").get()?.count, 0);
  } finally {
    db.close();
  }
});

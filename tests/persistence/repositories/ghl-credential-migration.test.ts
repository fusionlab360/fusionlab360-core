import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  openRehearsalDatabase, rehearsalDirectory, runCredentialMigration,
} from "../../../scripts/ghl-credential-migration";
import {
  createCredentialStorageConfiguration, encryptCredentialValue, integrationCredentialContext,
} from "../../../src/core/security/credential-storage";
import { CredentialRepository } from "../../../src/persistence/repositories/credential-repository";
import { OAuthInstallationRepository } from "../../../src/persistence/repositories/oauth-installation-repository";

const keyVersion = "synthetic-v1";
const makeKeyring = (byte: number) => JSON.stringify({ [keyVersion]: Buffer.alloc(32, byte).toString("base64") });
const keyring = makeKeyring(39);
const storage = (legacy = false, keys = keyring) => createCredentialStorageConfiguration({
  CORE_CREDENTIAL_ENCRYPTION_KEYS: keys,
  CORE_CREDENTIAL_ACTIVE_KEY_VERSION: keyVersion,
  CORE_CREDENTIAL_LEGACY_READS_ENABLED: legacy ? "true" : undefined,
});

const migrations = [
  "0001_create_tenants.sql",
  "0004_create_integration_credentials.sql",
  "0015_gohighlevel_oauth_installations.sql",
  "0016_oauth_installations.sql",
  "0021_integration_credential_auth_lifecycle.sql",
  "0027_enforce_ghl_location_ownership.sql",
];

async function fixture() {
  const target = { name: "fl360-ghl-p01-rehearsal-test", id: randomUUID() };
  const root = rehearsalDirectory(target);
  await mkdir(root);
  try {
    await mkdir(join(root, "d1"));
    await writeFile(join(root, "target.json"), JSON.stringify({ ...target, synthetic: true }), { flag: "wx" });
    const { db, close } = await openRehearsalDatabase(target);
    try {
      for (const migration of migrations) {
        // Each selected migration uses simple SQL statements, without triggers.
        const sql = (await readFile(join("migrations", migration), "utf8"))
          .replace(/^\s*--.*$/gm, "");
        for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
          await db.prepare(statement).run();
        }
      }
      for (const suffix of ["a", "b", "c"]) {
        await db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").bind(suffix, "Synthetic tenant").run();
        await db.prepare(`
          INSERT INTO integration_credentials
            (tenant_id, provider, auth_type, location_id, api_key, refresh_token, metadata)
          VALUES (?, 'gohighlevel', 'oauth2', ?, ?, ?, '{}')
        `).bind(suffix, `loc-${suffix}`, `synthetic-access-${suffix}`, `synthetic-refresh-${suffix}`).run();
      }
      await db.prepare(`
        INSERT INTO oauth_installations
          (provider, account_type, external_account_id, access_token, refresh_token, metadata)
        VALUES ('gohighlevel', 'company', 'company-a', 'synthetic-company-access', 'synthetic-company-refresh', '{}')
      `).run();
    } finally {
      await close();
    }
    return { target, root, dispose: () => rm(root, { recursive: true }) };
  } catch (error) {
    await rm(root, { recursive: true });
    throw error;
  }
}

function args(target: { name: string; id: string }, store = "locations", apply = false) {
  return [
    "--database-name", target.name, "--database-id", target.id,
    "--store", store, "--key-version", keyVersion, ...(apply ? ["--apply"] : []),
  ];
}

test("runner denies production and sanitizes configuration or storage failures", async () => {
  const target = { name: "fl360-ghl-p01-rehearsal-test", id: randomUUID() };
  const neverOpen = async (): Promise<never> => { throw new Error("synthetic-sensitive-error"); };
  assert.deepEqual(await runCredentialMigration(args({
    name: target.name, id: "e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4",
  }), keyring, neverOpen), { ok: false, code: "TARGET_DENIED" });
  assert.deepEqual(await runCredentialMigration(args({ ...target, name: "fusionlab360-db" }), keyring, neverOpen),
    { ok: false, code: "TARGET_DENIED" });
  assert.deepEqual(await runCredentialMigration([...args(target), "--remote"], keyring, neverOpen),
    { ok: false, code: "INVALID_ARGUMENTS" });
  assert.deepEqual(await runCredentialMigration([...args(target), "--batch", "51"], keyring, neverOpen),
    { ok: false, code: "INVALID_ARGUMENTS" });
  assert.deepEqual(await runCredentialMigration(args(target, "locations", true), undefined, neverOpen),
    { ok: false, code: "INVALID_KEY_CONFIGURATION" });
  assert.deepEqual(await runCredentialMigration(args(target), keyring, neverOpen),
    { ok: false, code: "MIGRATION_FAILED" });
  assert.deepEqual(await runCredentialMigration(args(target), keyring),
    { ok: false, code: "TARGET_UNAVAILABLE" });
});

test("persistent synthetic D1 converts both stores, resumes, and restores a cold recovery point", async (t) => {
  const { target, root, dispose } = await fixture();
  t.after(dispose);
  const run = async (store: string, apply = false) => {
    const result = await runCredentialMigration(args(target, store, apply), apply ? keyring : undefined);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const persist = join(root, "d1");
  const snapshot = join(root, "pre-conversion");
  await cp(persist, snapshot, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual((await run("locations")).before, { rows: 3, pendingRows: 3, pendingFields: 6 });
  assert.deepEqual((await run("installations")).before, { rows: 1, pendingRows: 1, pendingFields: 2 });
  assert.equal((await run("locations", true)).checkpoint, "pending");
  assert.equal((await run("installations", true)).checkpoint, "complete");

  let handle = await openRehearsalDatabase(target);
  try {
    const mixed = storage(true);
    const repository = new CredentialRepository(handle.db, mixed);
    assert.equal((await repository.findByTenantAndProvider("a", "gohighlevel"))?.apiKey, "synthetic-access-a");
    assert.equal((await repository.findByTenantAndProvider("b", "gohighlevel"))?.apiKey, "synthetic-access-b");
    const encrypted = await encryptCredentialValue(mixed.cipher!,
      integrationCredentialContext("b", "gohighlevel", "loc-b", "access"), "synthetic-access-b");
    await handle.db.prepare("UPDATE integration_credentials SET api_key = ? WHERE tenant_id = 'b'").bind(encrypted).run();
    assert.equal(await repository.findTenantIdByProviderAndLocation("gohighlevel", "loc-b"), "b");
    assert.equal(await repository.findByTenantAndProvider("foreign", "gohighlevel"), null);
  } finally { await handle.close(); }

  assert.deepEqual((await run("locations")).before, { rows: 3, pendingRows: 2, pendingFields: 3 });
  assert.equal((await run("locations", true)).checkpoint, "pending");
  assert.equal((await run("locations", true)).checkpoint, "complete");
  assert.equal((await run("locations", true)).convertedRows, 0);
  assert.equal((await run("installations", true)).convertedRows, 0);

  const verify = async (legacy: boolean) => {
    const location = new CredentialRepository(handle.db, storage(legacy));
    const company = new OAuthInstallationRepository(handle.db, storage(legacy));
    for (const suffix of ["a", "b", "c"]) {
      const record = await location.findByTenantAndProvider(suffix, "gohighlevel");
      assert.equal(record?.apiKey, `synthetic-access-${suffix}`);
      assert.equal(record?.refreshToken, `synthetic-refresh-${suffix}`);
    }
    const installed = await company.find("gohighlevel", "company", "company-a");
    assert.equal(installed?.accessToken, "synthetic-company-access");
    assert.equal(installed?.refreshToken, "synthetic-company-refresh");
  };
  handle = await openRehearsalDatabase(target);
  try {
    await verify(false);
    await assert.rejects(new CredentialRepository(handle.db, storage(false, makeKeyring(7)))
      .findByTenantAndProvider("a", "gohighlevel"), /authenticated/);
    await assert.rejects(new OAuthInstallationRepository(handle.db)
      .find("gohighlevel", "company", "company-a"), /encryption keys/);
  } finally { await handle.close(); }

  const start = performance.now();
  await rename(persist, join(root, "post-conversion"));
  await cp(snapshot, persist, { recursive: true, errorOnExist: true, force: false });
  handle = await openRehearsalDatabase(target);
  try { await verify(true); } finally { await handle.close(); }
  assert.equal((await run("locations")).before.pendingFields, 6);
  assert.equal((await run("installations")).before.pendingFields, 2);
  t.diagnostic(`Cold snapshot restore and eight-field readback: ${Math.round(performance.now() - start)} ms`);
});

test("compare-and-swap preserves a location refresh committed after the migration read", async (t) => {
  const { target, dispose } = await fixture();
  t.after(dispose);
  const result = await runCredentialMigration(args(target, "locations", true), keyring, async (requested) => {
    const { db, close } = await openRehearsalDatabase(requested);
    const repository = new CredentialRepository(db, storage(true));
    const raced = {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        if (!sql.includes("UPDATE integration_credentials SET api_key")) return statement;
        return {
          bind(...values: unknown[]) {
            const update = statement.bind(...values);
            return {
              async run() {
                const lease = "synthetic-race-lease";
                assert.equal(await repository.acquireOAuthRefreshLock("a", "gohighlevel", lease,
                  Date.now(), Date.now() + 60_000), true);
                assert.equal(await repository.saveRefreshedOAuthCredential("a", "gohighlevel", lease,
                  "synthetic-new-access", "synthetic-new-refresh", Date.now() + 60_000, "{}"), true);
                return update.run();
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    return { db: raced, close };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.convertedRows, 0);
  assert.equal(result.checkpoint, "retry_required");
  assert.equal(result.after.pendingRows, 2);
  const { db, close } = await openRehearsalDatabase(target);
  try {
    const record = await new CredentialRepository(db, storage()).findByTenantAndProvider("a", "gohighlevel");
    assert.equal(record?.apiKey, "synthetic-new-access");
    assert.equal(record?.refreshToken, "synthetic-new-refresh");
  } finally { await close(); }
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runProductionCredentialMigration } from "../../../scripts/ghl-credential-migration-production";
import { createCredentialCipher, encryptCredentialValue, integrationCredentialContext } from "../../../src/core/security/credential-storage";

const id = "e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4";
const account = "298b73e651f29df3116dfe3a36234866";
const name = "fusionlab360-db";
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}`;
const scope = ["--account", account, "--database", name, "--database-id", id];
const keyVersion = "synthetic-v1";
const keys = (byte: number) => JSON.stringify({ [keyVersion]: Buffer.alloc(32, byte).toString("base64") });
const secrets = { token: "synthetic-api-credential", keyring: keys(53) };
const version = ["--key-version", keyVersion];

function fakeD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE integration_credentials (tenant_id TEXT, provider TEXT, location_id TEXT,
      auth_type TEXT, api_key TEXT, refresh_token TEXT, updated_at TEXT);
    CREATE TABLE oauth_installations (provider TEXT, account_type TEXT, external_account_id TEXT,
      access_token TEXT, refresh_token TEXT, updated_at TEXT);
    INSERT INTO integration_credentials VALUES
      ('a','gohighlevel','loc-a','oauth2','synthetic-a-access','synthetic-a-refresh',NULL),
      ('b','gohighlevel','loc-b','oauth2','synthetic-b-access','synthetic-b-refresh',NULL),
      ('c','gohighlevel','loc-c','oauth2','synthetic-c-access','synthetic-c-refresh',NULL),
      ('d','another-provider','loc-d','oauth2','synthetic-other-access','synthetic-other-refresh',NULL);
    INSERT INTO oauth_installations VALUES
      ('gohighlevel','company','company-a','synthetic-co-access','synthetic-co-refresh',NULL);
  `);
  let updates = 0;
  let beforeUpdate: (() => void) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-api-credential");
    if (init.method === "GET") {
      assert.equal(input, endpoint);
      return Response.json({ success: true, result: { uuid: id, name } });
    }
    assert.equal(input, endpoint + "/query");
    assert.equal(init.method, "POST");
    const { sql, params } = JSON.parse(String(init.body));
    assert.ok(params.every((value: unknown) => typeof value === "string"));
    const statement = sqlite.prepare(sql);
    if (/^UPDATE\b/i.test(sql.trim())) {
      updates++;
      beforeUpdate?.();
      const result = statement.run(...params);
      return Response.json({ success: true, result: [{ success: true, results: [], meta: { changes: Number(result.changes) } }] });
    }
    assert.match(sql.trim(), /^SELECT\b/i);
    return Response.json({ success: true, result: [{ success: true, results: statement.all(...params) }] });
  };
  return { sqlite, fetcher, updates: () => updates, race: (change: () => void) => { beforeUpdate = change; } };
}

const argumentsFor = (store: string, mode: string, ...extra: string[]) => [...scope, "--store", store, "--mode", mode, ...extra];
const applyArgs = (store: string, expected: number) =>
  argumentsFor(store, "apply", ...version, "--confirm", id, "--expect-pending-fields", String(expected));

test("guards stop the production operator before any unapproved request or query", async () => {
  let requests = 0;
  const refuse: typeof fetch = async () => { requests++; throw new Error("synthetic-sensitive-detail"); };
  const missingTarget = argumentsFor("locations", "plan").map((arg) => arg === id ? "wrong-target" : arg);
  assert.deepEqual(await runProductionCredentialMigration(missingTarget, secrets, refuse), { ok: false, code: "TARGET_DENIED" });
  assert.deepEqual(await runProductionCredentialMigration(argumentsFor("locations", "apply", ...version), secrets, refuse),
    { ok: false, code: "INVALID_ARGUMENTS" });
  assert.deepEqual(await runProductionCredentialMigration(applyArgs("locations", 6), { token: secrets.token }, refuse),
    { ok: false, code: "KEY_CONFIGURATION_INVALID" });
  assert.equal(requests, 0);
  assert.deepEqual(await runProductionCredentialMigration(argumentsFor("locations", "plan"), secrets, refuse),
    { ok: false, code: "D1_RESPONSE_FAILED" });
  const mismatched: typeof fetch = async (_url, init) => {
    assert.equal(init?.method, "GET");
    return Response.json({ success: true, result: { uuid: id, name: "different-name" } });
  };
  assert.deepEqual(await runProductionCredentialMigration(argumentsFor("locations", "plan"), secrets, mismatched),
    { ok: false, code: "TARGET_MISMATCH" });
});

test("private runner plans, converts one row per call, and authenticates both stores with counts only", async (t) => {
  const d1 = fakeD1();
  t.after(() => d1.sqlite.close());
  const run = (args: string[], keyring = secrets.keyring) =>
    runProductionCredentialMigration(args, { ...secrets, keyring }, d1.fetcher);
  assert.deepEqual(await run(argumentsFor("locations", "plan")),
    { ok: true, store: "locations", mode: "plan", counts: { rows: 3, pendingRows: 3, pendingFields: 6 } });
  assert.deepEqual(await run(applyArgs("locations", 4)), { ok: false, code: "COUNTS_CHANGED" });
  assert.equal(d1.updates(), 0);
  for (const [store, checkpoints] of [["locations", [6, 4, 2]], ["installations", [2]]] as const) {
    for (const pending of checkpoints) {
      const result = await run(applyArgs(store, pending));
      assert.equal(result.ok, true);
      assert.equal("convertedRows" in result && result.convertedRows, 1);
      assert.equal("after" in result && result.after?.pendingFields, pending - 2);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-|fl360enc:/);
    }
    const result = await run(applyArgs(store, 0));
    assert.equal("convertedRows" in result && result.convertedRows, 0);
    assert.deepEqual(await run(argumentsFor(store, "verify", ...version)),
      { ok: true, store, mode: "verify", counts: { rows: checkpoints.length, pendingRows: 0, pendingFields: 0 },
        verifiedFields: checkpoints.length * 2 });
  }
  assert.equal(d1.updates(), 4);
  assert.deepEqual(await run(argumentsFor("locations", "verify", ...version), keys(54)),
    { ok: false, code: "VERIFICATION_FAILED" });
  assert.equal(d1.sqlite.prepare("SELECT api_key FROM integration_credentials WHERE tenant_id = 'd'").get()?.api_key,
    "synthetic-other-access");
});

test("scope drift is rejected and a concurrent refresh survives the conditional write", async (t) => {
  const d1 = fakeD1();
  t.after(() => d1.sqlite.close());
  const run = (args: string[]) => runProductionCredentialMigration(args, secrets, d1.fetcher);
  d1.sqlite.exec("UPDATE integration_credentials SET auth_type = 'api_key' WHERE tenant_id = 'c'");
  assert.deepEqual(await run(applyArgs("locations", 6)), { ok: false, code: "SCOPE_CHANGED" });
  assert.equal(d1.updates(), 0);
  d1.sqlite.exec("UPDATE integration_credentials SET auth_type = 'oauth2' WHERE tenant_id = 'c'");
  const cipher = createCredentialCipher({
    CORE_CREDENTIAL_ENCRYPTION_KEYS: secrets.keyring, CORE_CREDENTIAL_ACTIVE_KEY_VERSION: keyVersion,
  });
  const access = await encryptCredentialValue(cipher,
    integrationCredentialContext("a", "gohighlevel", "loc-a", "access"), "synthetic-new-access");
  const refresh = await encryptCredentialValue(cipher,
    integrationCredentialContext("a", "gohighlevel", "loc-a", "refresh"), "synthetic-new-refresh");
  d1.race(() => {
    d1.sqlite.prepare("UPDATE integration_credentials SET api_key = ?, refresh_token = ? WHERE tenant_id = 'a'").run(access, refresh);
  });
  const result = await run(applyArgs("locations", 6));
  assert.equal("checkpoint" in result && result.checkpoint, "recount_required");
  assert.equal("convertedRows" in result && result.convertedRows, 0);
  assert.equal("after" in result && result.after?.pendingFields, 4);
  assert.equal(d1.sqlite.prepare("SELECT refresh_token FROM integration_credentials WHERE tenant_id = 'a'").get()?.refresh_token, refresh);
});

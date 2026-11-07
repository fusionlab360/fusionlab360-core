import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { hashApiKey } from "../../../../src/core/security/api-key";
import { createMetaWhatsAppRoutes } from "../../../../src/integrations/messaging/meta-whatsapp/routes";

const keyRead = "fl360_synthetic_connection_reader";
const keyWrite = "fl360_synthetic_connection_operator";
const keyOther = "fl360_synthetic_other_tenant_operator";
const keyOauth = "fl360_synthetic_oauth_only_operator";
const connectionPath = "/integrations/meta-whatsapp/connections";
const connectionId = "connection-a";
const lifecycleEvidence = "onboarding-record:tenant-a-connection-a";
const lifecycleBody = (action: string, extras: Record<string, unknown> = {}) => JSON.stringify({
  action,
  evidenceReference: lifecycleEvidence,
  justification: "Verified the stored Meta authorization and GHL location ownership.",
  ghlLocationId: "location-a",
  ghlProviderId: "provider-a-123456",
  ...extras,
});

class LocalD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor(schemaReady = true) {
    for (const filename of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      if (!schemaReady && (filename.startsWith("0042_") || filename.startsWith("0045_"))) continue;
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
    }
    this.sqlite.exec(`
      INSERT INTO tenants(id,name) VALUES ('tenant-a','Tenant A'),('tenant-b','Tenant B');
      INSERT INTO integrations(id,tenant_id,provider,settings) VALUES
        ('meta-a','tenant-a','meta_whatsapp','{}'),
        ('meta-b','tenant-b','meta_whatsapp','{}'),
        ('ghl-a','tenant-a','gohighlevel','{"providerConfiguration":{"conversationProviderId":"provider-a-123456"}}'),
        ('ghl-b','tenant-b','gohighlevel','{"providerConfiguration":{"conversationProviderId":"provider-b-123456"}}');
      INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status)
        VALUES ('connection-a','tenant-a','meta-a','waba-a','phone-id-a','active'),
               ('connection-b','tenant-b','meta-b','waba-b','phone-id-b','active');
      INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id,refresh_token,metadata)
        VALUES ('tenant-a','gohighlevel','oauth2','synthetic-ghl-token-a','location-a','synthetic-refresh-a','{"companyId":"company-a","connectionStatus":"connected"}'),
               ('tenant-b','gohighlevel','oauth2','synthetic-ghl-token-b','location-b','synthetic-refresh-b','{"companyId":"company-b","connectionStatus":"connected"}');
      UPDATE meta_whatsapp_connections SET status='active' WHERE id IN ('connection-a','connection-b');
      INSERT INTO meta_whatsapp_credentials(id,tenant_id,integration_id,connection_id,provider,status,ciphertext,nonce,algorithm,key_version,credential_version,metadata)
        VALUES ('credential-a','tenant-a','meta-a','connection-a','meta_whatsapp','active','synthetic-ciphertext-a','synthetic-nonce-a','AES-GCM','v1',1,
          '{"scopes":["whatsapp_business_management","whatsapp_business_messaging"],"expiresAt":4102444800000,"lifecycle":"expiring"}'),
               ('credential-b','tenant-b','meta-b','connection-b','meta_whatsapp','active','synthetic-ciphertext-b','synthetic-nonce-b','AES-GCM','v1',1,
          '{"scopes":["whatsapp_business_management","whatsapp_business_messaging"],"expiresAt":4102444800000,"lifecycle":"expiring"}');
    `);
  }
  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
    };
    return statement as unknown as D1PreparedStatement;
  }
  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}

async function setup(schemaReady = true) {
  const db = new LocalD1(schemaReady);
  for (const [id, tenant, secret, permissions] of [
    ["reader-a", "tenant-a", keyRead, ["integrations:read"]],
    ["operator-a", "tenant-a", keyWrite, ["integrations:write"]],
    ["operator-b", "tenant-b", keyOther, ["integrations:read", "integrations:write"]],
    ["oauth-only", "tenant-a", keyOauth, ["integrations:oauth:connect"]],
  ] as const) {
    await db.sqlite.prepare("INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES(?,?,?,?,'active',?)")
      .run(id, tenant, id, await hashApiKey(secret), JSON.stringify(permissions));
  }
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.route("/integrations/meta-whatsapp", createMetaWhatsAppRoutes());
  const request = (secret: string | undefined, path: string, init: RequestInit = {}, lifecycleEnabled = "false", activationEvidence = `tenant-a:${lifecycleEvidence}`) => app.request(path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
  }, {
    DB: db.binding(),
    WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: lifecycleEnabled,
    WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST: activationEvidence,
    META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) }),
    META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1",
    GHL_CUSTOM_PROVIDER_ENABLED: "true",
    GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "location-a,location-b",
  } as AppBindings);
  return { db, request };
}

test("connection inventory is authenticated, tenant-scoped, bounded and credential-safe", async () => {
  const { db, request } = await setup();
  try {
    assert.equal((await request(undefined, connectionPath)).status, 401);
    assert.equal((await request(keyOauth, connectionPath)).status, 403);
    const response = await request(keyRead, connectionPath);
    assert.equal(response.status, 200);
    const json = await response.json() as { connections: Array<Record<string, unknown>> };
    assert.equal(json.connections.length, 1);
    assert.equal(json.connections[0]?.id, connectionId);
    assert.equal(json.connections[0]?.activationState, "pending");
    assert.equal(json.connections[0]?.credentialHealth, "VALID_EXPIRING");
    assert.deepEqual(Object.keys(json.connections[0]!).sort(), [
      "activationState", "connectionStatus", "createdAt", "credentialHealth", "credentialStatus",
      "credentialVersion", "ghlLocationId", "ghlProviderId", "id", "integrationId", "phoneNumberId",
      "updatedAt", "wabaId",
    ].sort());
    assert.doesNotMatch(JSON.stringify(json), /synthetic-(?:ghl|refresh|ciphertext|nonce)|token|message/i);
    assert.equal((await request(keyRead, `${connectionPath}?limit=101`)).status, 400);
    assert.equal((await request(keyRead, `${connectionPath}?offset=-1`)).status, 400);
    const other = await request(keyOther, connectionPath);
    assert.deepEqual((await other.json() as { connections: unknown[] }).connections.map((row) => (row as { id: string }).id), ["connection-b"]);
  } finally { db.close(); }
});

test("pre-0042 connection inventory remains readable and lifecycle writes fail closed without schema changes", async () => {
  const { db, request } = await setup(false);
  try {
    const before = (db.sqlite.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const list = await request(keyRead, connectionPath);
    assert.equal(list.status, 200);
    const json = await list.json() as { connections: Array<{ activationState: string }>; lifecycleSchemaReady: boolean };
    assert.equal(json.lifecycleSchemaReady, false);
    assert.equal(json.connections[0]?.activationState, "not_migrated");
    const write = await request(keyWrite, `${connectionPath}/${connectionId}/lifecycle`, {
      method: "POST", body: lifecycleBody("activate"),
    }, "true");
    assert.equal(write.status, 503);
    assert.deepEqual(await write.json(), { success: false, code: "SCHEMA_NOT_READY" });
    assert.equal((db.sqlite.prepare("SELECT total_changes() AS n").get() as { n: number }).n, before);
  } finally { db.close(); }
});

test("lifecycle decisions remain default-off and require integrations:write", async () => {
  const { db, request } = await setup();
  try {
    const body = lifecycleBody("activate");
    assert.equal((await request(undefined, `${connectionPath}/${connectionId}/lifecycle`, { method: "POST", body }, "true")).status, 401);
    assert.equal((await request(keyRead, `${connectionPath}/${connectionId}/lifecycle`, { method: "POST", body }, "true")).status, 403);
    const before = (db.sqlite.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const disabled = await request(keyWrite, `${connectionPath}/${connectionId}/lifecycle`, { method: "POST", body }, "false");
    assert.equal(disabled.status, 404);
    assert.equal((db.sqlite.prepare("SELECT total_changes() AS n").get() as { n: number }).n, before);
  } finally { db.close(); }
});

test("activation requires tenant-owned GHL location/provider and valid Meta credential evidence", async () => {
  const { db, request } = await setup();
  try {
    const endpoint = `${connectionPath}/${connectionId}/lifecycle`;
    const crossTenant = await request(keyOther, `${connectionPath}/connection-a/lifecycle`, { method: "POST", body: lifecycleBody("activate") }, "true");
    assert.equal(crossTenant.status, 404);
    const crossTenantEvidence = await request(keyOther, `${connectionPath}/connection-b/lifecycle`, { method: "POST", body: lifecycleBody("activate", { ghlLocationId: "location-b", ghlProviderId: "provider-b-123456" }) }, "true");
    assert.equal(crossTenantEvidence.status, 409);
    assert.deepEqual(await crossTenantEvidence.json(), { success: false, code: "EVIDENCE_NOT_APPROVED" });
    const badEvidence = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { evidenceReference: "https://unverified.invalid/record" }) }, "true");
    assert.equal(badEvidence.status, 400);
    const unsafeReason = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { justification: "Bearer secret-token-value was verified by our operator." }) }, "true");
    assert.equal(unsafeReason.status, 400);
    const wrongLocation = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { ghlLocationId: "location-b" }) }, "true");
    assert.equal(wrongLocation.status, 409);
    const wrongProvider = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { ghlProviderId: "provider-b-123456" }) }, "true");
    assert.equal(wrongProvider.status, 409);
    const unapprovedEvidence = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { evidenceReference: "other-record:unverified" }) }, "true");
    assert.equal(unapprovedEvidence.status, 409);
    const noEvidencePolicy = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate") }, "true", "");
    assert.equal(noEvidencePolicy.status, 409);
    assert.equal(db.sqlite.prepare("SELECT activation_state FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.activation_state, "pending");
    const activated = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate", { operatorId: "forged", tenantId: "tenant-b" }) }, "true");
    assert.equal(activated.status, 200);
    assert.deepEqual(await activated.json(), { success: true, status: "active", idempotent: false });
    assert.equal(db.sqlite.prepare("SELECT activation_actor FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.activation_actor, "operator-a");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_connection_activation_audit WHERE tenant_id='tenant-a' AND connection_id='connection-a' AND actor_client_id='operator-a'").get()?.n, 1);
    assert.equal(JSON.stringify(await (await request(keyRead, connectionPath)).json()).includes("synthetic-ghl-token-a"), false);
  } finally { db.close(); }
});

test("suspend and revoke append audit decisions, revoke credential material, and remain tenant-isolated", async () => {
  const { db, request } = await setup();
  try {
    const endpoint = `${connectionPath}/${connectionId}/lifecycle`;
    const activate = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate") }, "true");
    assert.equal(activate.status, 200);
    const suspended = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("suspend", { evidenceReference: "incident:operator-ticket-77" }) }, "true");
    assert.equal(suspended.status, 200);
    assert.equal(db.sqlite.prepare("SELECT activation_state FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.activation_state, "suspended");
    assert.equal((await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate") }, "true")).status, 200);
    const revoked = await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("revoke", { evidenceReference: "decommission:operator-ticket-78" }) }, "true");
    assert.equal(revoked.status, 200);
    assert.equal(db.sqlite.prepare("SELECT activation_state FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.activation_state, "revoked");
    assert.equal(db.sqlite.prepare("SELECT status FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.status, "disabled");
    const credential = db.sqlite.prepare("SELECT status,ciphertext,nonce FROM meta_whatsapp_credentials WHERE connection_id='connection-a'").get() as { status: string; ciphertext: string | null; nonce: string | null };
    assert.equal(credential.status, "revoked");
    assert.equal(credential.ciphertext, null);
    assert.equal(credential.nonce, null);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_connection_activation_audit WHERE tenant_id='tenant-a' AND connection_id='connection-a'").get()?.n, 4);
    assert.equal((await request(keyWrite, `${connectionPath}/connection-b/lifecycle`, { method: "POST", body: lifecycleBody("revoke", { ghlLocationId: "location-b", ghlProviderId: "provider-b-123456" }) }, "true")).status, 404);
  } finally { db.close(); }
});

test("activation fails closed when Meta credential or GHL installed-location ownership is absent", async () => {
  const { db, request } = await setup();
  try {
    const endpoint = `${connectionPath}/${connectionId}/lifecycle`;
    db.sqlite.prepare("UPDATE meta_whatsapp_credentials SET metadata='{}' WHERE connection_id='connection-a'").run();
    assert.equal((await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate") }, "true")).status, 409);
    db.sqlite.prepare("UPDATE meta_whatsapp_credentials SET metadata=? WHERE connection_id='connection-a'").run(JSON.stringify({ scopes: ["whatsapp_business_management", "whatsapp_business_messaging"], expiresAt: 4102444800000, lifecycle: "expiring" }));
    db.sqlite.prepare("UPDATE integration_credentials SET metadata=? WHERE tenant_id='tenant-a' AND provider='gohighlevel'")
      .run(JSON.stringify({ connectionStatus: "disconnected", companyId: "company-a" }));
    assert.equal((await request(keyWrite, endpoint, { method: "POST", body: lifecycleBody("activate") }, "true")).status, 409);
    assert.equal(db.sqlite.prepare("SELECT activation_state FROM meta_whatsapp_connections WHERE id='connection-a'").get()?.activation_state, "pending");
  } finally { db.close(); }
});

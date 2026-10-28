import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import type { RequestContext } from "../../../../src/context";
import { hashApiKey } from "../../../../src/core/security/api-key";
import { isMetaWhatsAppDeveloperTestAuthorized } from "../../../../src/integrations/messaging/meta-whatsapp/developer-test-config";
import { MetaWhatsAppOnboardingError, MetaWhatsAppOnboardingService, type MetaDeveloperTestAuthorizationProvider, type MetaVerifiedAuthorization, type MetaWhatsAppOnboardingProvider } from "../../../../src/integrations/messaging/meta-whatsapp/onboarding";
import { createMetaWhatsAppRoutes } from "../../../../src/integrations/messaging/meta-whatsapp/routes";
import { createMetaWhatsAppCredentialVault } from "../../../../src/integrations/messaging/meta-whatsapp/credential-vault";
import { MetaWhatsAppGraphOnboardingProvider } from "../../../../src/integrations/messaging/meta-whatsapp/graph-onboarding-provider";

const WABA_ID = "2182329942321588";
const PHONE_ID = "1452502451268655";
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const DEVELOPER_TEST_PATH = "https://core.test/integrations/meta-whatsapp/onboarding/developer-test/complete";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(join(process.cwd(), "migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8"));
    }
    this.sqlite.exec("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B'); INSERT INTO integrations (id, tenant_id, provider) VALUES ('meta-a', 'tenant-a', 'meta_whatsapp'), ('ghl-a', 'tenant-a', 'gohighlevel'), ('staah-a', 'tenant-a', 'staah');");
  }
  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }
  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}

class TestProvider implements MetaWhatsAppOnboardingProvider, MetaDeveloperTestAuthorizationProvider {
  authorization: MetaVerifiedAuthorization = {
    accessToken: "temporary-test-token",
    scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  async exchangeAuthorizationCode(): Promise<MetaVerifiedAuthorization> { return this.authorization; }
  async validateDeveloperTestToken(): Promise<MetaVerifiedAuthorization> { return this.authorization; }
  async verifyWabaAccess(): Promise<boolean> { return true; }
  async listPhoneNumbers(): Promise<readonly string[]> { return [PHONE_ID]; }
  async verifyWebhookSubscription(): Promise<boolean> { return true; }
}

function bindings(db: SQLiteD1): AppBindings {
  return {
    DB: db.binding(),
    META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: key }),
    META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1",
    META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED: "true",
    META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST: "tenant-a",
    META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST: WABA_ID,
    META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST: PHONE_ID,
  } as AppBindings;
}

async function seedClient(db: SQLiteD1, tenantId: string, permissions: string[], token: string) {
  const hash = await hashApiKey(token);
  db.sqlite.prepare("INSERT INTO clients (id, tenant_id, name, api_key_hash, status, permissions) VALUES (?, ?, ?, ?, 'active', ?)")
    .run(`client-${tenantId}`, tenantId, `Client ${tenantId}`, hash, JSON.stringify(permissions));
}

function createApp(db: SQLiteD1, provider: TestProvider, tenantId: string, permissions: string[]) {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    const context = {
      client: { id: `client-${tenantId}`, tenantId, permissions },
      tenant: { id: tenantId, name: tenantId, status: "active" },
    } as unknown as RequestContext;
    c.set("context", context);
    c.set("principal", { type: "client", clientId: `client-${tenantId}`, tenantId, permissions } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations/meta-whatsapp", createMetaWhatsAppRoutes(provider));
  return app;
}

async function state(db: SQLiteD1, provider: TestProvider, tenantId = "tenant-a", operatorId = "client-tenant-a") {
  return new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).start({ tenantId, operatorId, integrationId: "meta-a" });
}

test("developer test configuration fails closed unless every exact value matches", () => {
  const db = new SQLiteD1();
  const configuration = bindings(db);
  try {
    assert.equal(isMetaWhatsAppDeveloperTestAuthorized(configuration, { tenantId: "tenant-a", wabaId: WABA_ID, phoneNumberId: PHONE_ID }), true);
    assert.equal(isMetaWhatsAppDeveloperTestAuthorized(configuration, { tenantId: "tenant-b", wabaId: WABA_ID, phoneNumberId: PHONE_ID }), false);
    assert.equal(isMetaWhatsAppDeveloperTestAuthorized(configuration, { tenantId: "tenant-a", wabaId: "99999999", phoneNumberId: PHONE_ID }), false);
    assert.equal(isMetaWhatsAppDeveloperTestAuthorized({ ...configuration, META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST: "tenant-a,*" }, { tenantId: "tenant-a", wabaId: WABA_ID, phoneNumberId: PHONE_ID }), false);
  } finally { db.close(); }
});

test("authorized developer token onboarding stores an encrypted, expiring tenant-owned credential", async () => {
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    const started = await state(db, provider);
    const result = await new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).completeDeveloperTest({
      tenantId: "tenant-a", operatorId: "client-tenant-a", state: started.state, accessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID,
    }, provider);
    assert.equal(result.status, "active");
    const credential = db.sqlite.prepare("SELECT ciphertext, metadata FROM meta_whatsapp_credentials").get() as { ciphertext: string; metadata: string };
    assert.notEqual(credential.ciphertext, "temporary-test-token");
    assert.deepEqual(JSON.parse(credential.metadata), {
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      expiresAt: provider.authorization.expiresAt,
      developerTest: true,
    });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integrations WHERE id IN ('ghl-a', 'staah-a')").get()?.count, 2);
  } finally { db.close(); }
});

test("developer token onboarding rejects missing scopes, expired tokens, wrong app validation, and cross-tenant state", async () => {
  for (const authorization of [
    { accessToken: "token", scopes: ["whatsapp_business_management"], expiresAt: Date.now() + 60 * 60 * 1000 },
    { accessToken: "token", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"], expiresAt: Date.now() - 1 },
  ]) {
    const db = new SQLiteD1();
    try {
      const provider = new TestProvider(); provider.authorization = authorization;
      const started = await state(db, provider);
      await assert.rejects(new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).completeDeveloperTest({ tenantId: "tenant-a", operatorId: "client-tenant-a", state: started.state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, provider), MetaWhatsAppOnboardingError);
    } finally { db.close(); }
  }
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    const started = await state(db, provider);
    await assert.rejects(new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).completeDeveloperTest({ tenantId: "tenant-b", operatorId: "client-tenant-a", state: started.state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, provider), MetaWhatsAppOnboardingError);
    const wrongApp: MetaDeveloperTestAuthorizationProvider = { validateDeveloperTestToken: async () => { throw new Error("wrong app"); } };
    const next = await state(db, provider);
    await assert.rejects(new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).completeDeveloperTest({ tenantId: "tenant-a", operatorId: "client-tenant-a", state: next.state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, wrongApp));
  } finally { db.close(); }
});

test("Graph developer token validation rejects a token issued to another Meta app", async () => {
  const provider = new MetaWhatsAppGraphOnboardingProvider(
    "expected-app",
    "synthetic-secret",
    "v22.0",
    async () => new Response(JSON.stringify({
      data: {
        app_id: "different-app",
        is_valid: true,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    }), { status: 200 }),
  );
  await assert.rejects(provider.validateDeveloperTestToken("temporary-test-token"));
});

test("protected developer route rejects wrong permissions and asset tuples without caller-controlled tenant selection", async () => {
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    await seedClient(db, "tenant-a", ["integrations:oauth:connect", "integrations:write"], "fl360_tenant_a");
    await seedClient(db, "tenant-b", ["integrations:oauth:connect", "integrations:write"], "fl360_tenant_b");
    const started = await state(db, provider);
    const app = createApp(db, provider, "tenant-a", ["integrations:oauth:connect", "integrations:write"]);
    const accepted = await app.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: started.state, temporaryAccessToken: "temporary-test-token", tenantId: "tenant-b", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
    }, bindings(db));
    assert.equal(accepted.status, 200);
    assert.equal(db.sqlite.prepare("SELECT tenant_id FROM meta_whatsapp_connections").get()?.tenant_id, "tenant-a");

    const secondState = await state(db, provider);
    const wrongAsset = await app.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: secondState.state, temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: "99999999" }),
    }, bindings(db));
    assert.equal(wrongAsset.status, 404);

    const wrongWaba = await app.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: secondState.state, temporaryAccessToken: "temporary-test-token", wabaId: "99999999", phoneNumberId: PHONE_ID }),
    }, bindings(db));
    assert.equal(wrongWaba.status, 404);

    const disabledState = await state(db, provider);
    const disabled = await app.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: disabledState.state, temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
    }, { ...bindings(db), META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED: "false" });
    assert.equal(disabled.status, 404);

    const otherTenant = createApp(db, provider, "tenant-b", ["integrations:oauth:connect", "integrations:write"]);
    const rejectedTenant = await otherTenant.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_b", "Content-Type": "application/json" },
      body: JSON.stringify({ state: "not-used", temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
    }, bindings(db));
    assert.equal(rejectedTenant.status, 404);

    const noWrite = createApp(db, provider, "tenant-a", ["integrations:oauth:connect"]);
    const deniedWrite = await noWrite.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: "not-used", temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
    }, bindings(db));
    assert.equal(deniedWrite.status, 403);

    db.sqlite.prepare("UPDATE clients SET permissions = ? WHERE id = 'client-tenant-a'")
      .run(JSON.stringify(["integrations:write"]));
    const noConnect = createApp(db, provider, "tenant-a", ["integrations:write"]);
    const deniedConnect = await noConnect.request(DEVELOPER_TEST_PATH, {
      method: "POST", headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
      body: JSON.stringify({ state: "not-used", temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
    }, bindings(db));
    assert.equal(deniedConnect.status, 403);
  } finally { db.close(); }
});

test("developer test route rejects plaintext transport before reading a token", async () => {
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    await seedClient(db, "tenant-a", ["integrations:oauth:connect", "integrations:write"], "fl360_tenant_a");
    const response = await createApp(db, provider, "tenant-a", ["integrations:oauth:connect", "integrations:write"])
      .request("http://core.test/integrations/meta-whatsapp/onboarding/developer-test/complete", {
        method: "POST",
        headers: { Authorization: "Bearer fl360_tenant_a", "Content-Type": "application/json" },
        body: JSON.stringify({ temporaryAccessToken: "temporary-test-token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }),
      }, bindings(db));
    assert.equal(response.status, 400);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_credentials").get()?.count, 0);
  } finally { db.close(); }
});

test("developer test reauthorization reuses the owned connection instead of creating a duplicate", async () => {
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    const service = new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider);
    const first = await service.completeDeveloperTest({ tenantId: "tenant-a", operatorId: "client-tenant-a", state: (await state(db, provider)).state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, provider);
    const second = await service.completeDeveloperTest({ tenantId: "tenant-a", operatorId: "client-tenant-a", state: (await state(db, provider)).state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, provider);
    assert.equal(second.connectionId, first.connectionId);
    assert.ok(second.credentialVersion > first.credentialVersion);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_connections").get()?.count, 1);
  } finally { db.close(); }
});

test("expired developer credentials cannot be resolved for later delivery", async () => {
  const db = new SQLiteD1();
  try {
    const provider = new TestProvider();
    const started = await state(db, provider);
    await new MetaWhatsAppOnboardingService(db.binding(), bindings(db), provider).completeDeveloperTest({ tenantId: "tenant-a", operatorId: "client-tenant-a", state: started.state, accessToken: "token", wabaId: WABA_ID, phoneNumberId: PHONE_ID }, provider);
    db.sqlite.prepare("UPDATE meta_whatsapp_credentials SET metadata = ?").run(JSON.stringify({ developerTest: true, expiresAt: Date.now() - 1 }));
    const connection = db.sqlite.prepare("SELECT id FROM meta_whatsapp_connections").get() as { id: string };
    await assert.rejects(createMetaWhatsAppCredentialVault(db.binding(), bindings(db)).resolve({ tenantId: "tenant-a", integrationId: "meta-a", connectionId: connection.id, provider: "meta_whatsapp" }));
  } finally { db.close(); }
});

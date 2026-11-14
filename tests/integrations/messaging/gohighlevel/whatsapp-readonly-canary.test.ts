import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import CryptoJS from "crypto-js";
import { createApplication } from "../../../../src/bootstrap/routes";
import { createWhatsAppReadonlyCanary } from "../../../../src/integrations/messaging/gohighlevel/whatsapp-readonly-canary";

const secret = "fixture-shared-secret";
const tenant = "tenant_fixture";
const location = "location_approved";
const user = "user_approved";
const appId = "marketplace_app";
const company = "company_fixture";
const providerId = "provider_fixture_01";
const futureExpiry = Date.now() + 86400000;

function context(changes: Record<string, unknown> = {}): string {
  return CryptoJS.AES.encrypt(JSON.stringify({
    userId: user, companyId: company, activeLocation: location, role: "admin", type: "location", appStatus: "live", ...changes,
  }), secret).toString();
}

function env(overrides: Record<string, unknown> = {}): never {
  return {
    APP_ENVIRONMENT: "preview",
    WABA_GHL_READONLY_PREVIEW_ENABLED: "true",
    WABA_GHL_READONLY_PREVIEW_LOCATION_ALLOWLIST: location,
    WABA_GHL_READONLY_PREVIEW_TENANT_ALLOWLIST: tenant,
    WABA_GHL_READONLY_PREVIEW_USER_ALLOWLIST: user,
    WABA_GHL_READONLY_PREVIEW_COMPANY_ALLOWLIST: company,
    WABA_GHL_READONLY_PREVIEW_APP_ID: appId,
    GHL_APP_SHARED_SECRET: secret,
    GHL_WHATSAPP_PAGE_PARENT_ORIGINS: "https://app.gohighlevel.com",
    META_WHATSAPP_GHL_INBOUND_ENABLED: "true",
    META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST: tenant,
    GHL_CUSTOM_PROVIDER_ENABLED: "true",
    GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: location,
    GHL_META_WHATSAPP_OUTBOUND_ENABLED: "false",
    DB: { prepare: () => { throw new Error("Unexpected D1 operation"); } },
    ...overrides,
  } as never;
}

function installationRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: tenant,
    tenant_status: "active",
    integration_enabled: 1,
    credential_auth_type: "oauth2",
    credential_configured: 1,
    connected_metadata: 1,
    location_account_metadata: 1,
    app_matches: 1,
    company_matches: 1,
    location_matches: 1,
    provider_identifier: providerId,
    ...overrides,
  };
}

function readonlyDb(options: { installation?: Record<string, unknown> | null; connection?: boolean; credential?: boolean } = {}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      assert.match(sql.trim(), /^SELECT\b/i, "Canary D1 access must be SELECT-only");
      assert.doesNotMatch(sql, /SELECT\s+(?:credential\.)?(?:api_key|refresh_token|ciphertext|nonce)|SELECT\s+credential\.\*/i,
        "Canary queries must not project credential values");
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
      return {
        bind(...values: unknown[]) {
          queries.push({ sql, values });
          return {
            all: async () => {
              if (sql.includes("FROM integration_credentials credential")) {
                return { results: options.installation === undefined ? [installationRow()] : options.installation ? [options.installation] : [] };
              }
              if (sql.includes("FROM meta_whatsapp_connections connection")) {
                return { results: options.connection === false ? [] : [{ id: "meta_connection_fixture", integration_id: "meta_integration_fixture", status: "active" }] };
              }
              throw new Error("Unexpected canary SELECT");
            },
            first: async () => {
              if (sql.includes("FROM meta_whatsapp_credentials credential")) {
                return options.credential === false ? null : { status: "active", configured: 1, metadata: JSON.stringify({ expiresAt: futureExpiry }) };
              }
              throw new Error("Unexpected first() query");
            },
          };
        },
      };
    },
  };
  return { db, queries };
}

const expectedStatus = {
  connectionRecord: "Present",
  connectionState: "active (stored)",
  credentialRecord: "Present",
  credentialState: "active (stored)",
  credentialConfigured: "Yes",
  credentialExpiryMetadata: "Expiry metadata appears current; token not tested",
  providerConfiguration: "Configured in stored settings",
  providerGlobal: "Enabled",
  providerLocationGate: "Allowed",
  providerOperationalVerification: "Not verified",
  inboundGlobal: "Enabled",
  inboundTenantGate: "Allowed",
  inboundAvailability: "Not operationally verified",
  outboundGlobal: "Disabled",
  outboundAvailability: "Disabled",
  deliveryOperationalVerification: "Not verified",
  requirements: [
    "GHL-to-Meta outbound is disabled by its global switch",
    "Provider operation and message delivery have not been tested by this page",
  ],
  lastVerified: "Not available",
  lastError: "Not available",
};

test("production gate is default OFF and Preview gate is separate", async () => {
  const app = createWhatsAppReadonlyCanary();
  const path = "https://api.test/";
  assert.equal((await app.request(path, {}, env({ APP_ENVIRONMENT: "production" }))).status, 404);
  assert.equal((await app.request(path, {}, env({
    APP_ENVIRONMENT: "production",
    WABA_GHL_READONLY_ENABLED: "true",
    WABA_GHL_READONLY_TENANT_ALLOWLIST: tenant,
    WABA_GHL_READONLY_LOCATION_ALLOWLIST: location,
    WABA_GHL_READONLY_USER_ALLOWLIST: user,
    WABA_GHL_READONLY_COMPANY_ALLOWLIST: company,
    WABA_GHL_READONLY_APP_ID: appId,
  }))).status, 200);
  assert.equal((await app.request(path, {}, env({
    APP_ENVIRONMENT: "production", WABA_GHL_READONLY_ENABLED: "true",
    WABA_GHL_READONLY_LOCATION_ALLOWLIST: `${location},other`,
  }))).status, 404, "multi-value production allowlists fail closed");
});

test("missing, malformed, wrong-user, wrong-location, wrong-company and wrong-app contexts are rejected", async () => {
  const app = createWhatsAppReadonlyCanary();
  const cases: Array<[string | undefined, Record<string, unknown>, string]> = [
    [undefined, {}, "CONTEXT_NOT_RECEIVED"],
    ["invalid", {}, "CONTEXT_MALFORMED"],
    [context({ role: "user" }), {}, "USER_NOT_ALLOWED"],
    [context({ userId: "other" }), {}, "USER_NOT_ALLOWED"],
    [context({ activeLocation: "other" }), {}, "LOCATION_NOT_ALLOWED"],
    [context({ companyId: "other" }), {}, "COMPANY_NOT_ALLOWED"],
    [context({ appStatus: "draft" }), {}, "APP_NOT_ALLOWED"],
    [context(), { WABA_GHL_READONLY_PREVIEW_USER_ALLOWLIST: "other" }, "USER_NOT_ALLOWED"],
    [context(), { WABA_GHL_READONLY_PREVIEW_LOCATION_ALLOWLIST: "other" }, "LOCATION_NOT_ALLOWED"],
    [context(), { WABA_GHL_READONLY_PREVIEW_COMPANY_ALLOWLIST: "other" }, "COMPANY_NOT_ALLOWED"],
  ];
  for (const [payload, overrides, errorCode] of cases) {
    const headers: Record<string, string> = payload ? { "X-GHL-Encrypted-Context": payload } : {};
    const response = await app.request("https://api.test/status", { headers }, env(overrides));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { success: false, errorCode });
  }
  const badSecret = await app.request("https://api.test/status", {
    headers: { "X-GHL-Encrypted-Context": CryptoJS.AES.encrypt("{}", "wrong-secret").toString() },
  }, env());
  assert.deepEqual(await badSecret.json(), { success: false, errorCode: "CONTEXT_DECRYPT_FAILED" });
});

test("authorized context uses exact tenant/app/company/location installation and returns only scoped status", async () => {
  const { db, queries } = readonlyDb();
  const app = createWhatsAppReadonlyCanary();
  const response = await app.request("https://api.test/status", {
    headers: { "X-GHL-Encrypted-Context": context({ futureFieldFromHighLevel: { ignored: true } }) },
  }, env({ DB: db }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, location, status: expectedStatus });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries[0].values, [appId, company, location, location]);
  assert.deepEqual(queries[1].values, [tenant]);
  assert.deepEqual(queries[2].values, [tenant, "meta_integration_fixture", "meta_connection_fixture"]);
});

test("tenant, app, company, location, credential and installation mismatches fail closed", async () => {
  const app = createWhatsAppReadonlyCanary();
  const cases: Array<[Record<string, unknown> | null, string]> = [
    [{ ...installationRow(), tenant_id: "other_tenant" }, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), app_matches: 0 }, "APP_NOT_ALLOWED"],
    [{ ...installationRow(), company_matches: 0 }, "COMPANY_NOT_ALLOWED"],
    [{ ...installationRow(), location_matches: 0 }, "LOCATION_NOT_ALLOWED"],
    [{ ...installationRow(), connected_metadata: 0 }, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), credential_configured: 0 }, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), integration_enabled: 0 }, "INSTALLATION_NOT_MATCHED"],
    [null, "INSTALLATION_NOT_MATCHED"],
  ];
  for (const [row, errorCode] of cases) {
    const { db } = readonlyDb({ installation: row });
    const response = await app.request("https://api.test/status", {
      headers: { "X-GHL-Encrypted-Context": context() },
    }, env({ DB: db }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { success: false, errorCode });
  }
});

test("status query failure is sanitized and never turns into an installation claim", async () => {
  const app = createWhatsAppReadonlyCanary();
  const db = { prepare: () => { throw new Error("synthetic schema details and secrets"); } };
  const response = await app.request("https://api.test/status", {
    headers: { "X-GHL-Encrypted-Context": context() },
  }, env({ DB: db }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, errorCode: "STATUS_UNAVAILABLE" });
});

test("page is read-only, escaped through textContent, parent-origin restricted and contains status limitations", async () => {
  const app = createWhatsAppReadonlyCanary();
  const response = await app.request("https://api.test/", {}, env());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors https:\/\/app\.gohighlevel\.com/);
  assert.equal(response.headers.get("x-frame-options"), null);
  const html = await response.text();
  assert.match(html, /Technical details/);
  assert.match(html, /first-use freshness guarantee/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /Activate|Suspend|Revoke|credential\/refresh|\/messages/);
  assert.equal((await app.request("https://api.test/?tenant=tenant_fixture", {}, env())).status, 404);
});

test("only GET is mounted and request-controlled body/query cannot affect authorization", async () => {
  const app = createWhatsAppReadonlyCanary();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal((await app.request("https://api.test/status", { method }, env())).status, 404);
  }
  const query = await app.request(`https://api.test/status?location=${location}`, {
    headers: { "X-GHL-Encrypted-Context": context() },
  }, env());
  assert.equal(query.status, 400);
  assert.deepEqual(await query.json(), { success: false, errorCode: "REQUEST_REJECTED" });
});

test("full app Preview preserves iframe CSP and denies missing context", async () => {
  const app = createApplication("preview");
  const previewEnv = env({ APP_ENVIRONMENT: "preview", JWT_SECRET: undefined });
  const page = await app.request("https://preview.test/marketplace/gohighlevel/whatsapp-preview", {}, previewEnv);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors https:\/\/app\.gohighlevel\.com/);
  const status = await app.request("https://preview.test/marketplace/gohighlevel/whatsapp-preview/status", {}, previewEnv);
  assert.equal(status.status, 403);
  assert.deepEqual(await status.json(), { success: false, errorCode: "CONTEXT_NOT_RECEIVED" });
});

test("GHL Custom Page listener is registered before request and accepts a fast valid parent response once", async () => {
  const page = await (await createWhatsAppReadonlyCanary().request("https://preview.test/", {}, env())).text();
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let handler: ((event: { source: unknown; origin: string; data: unknown }) => void) | undefined;
  let posts = 0;
  let fetches = 0;
  const loading = { hidden: false };
  const details = { hidden: true };
  const error = { hidden: true, textContent: "" };
  const requirements = { children: [] as unknown[], replaceChildren() { this.children = []; }, append(value: unknown) { this.children.push(value); } };
  const ids = ["location", "connection-record", "connection-state", "credential-record", "credential-configured", "credential-metadata", "provider-config", "provider-global", "provider-location", "provider-operation", "inbound-global", "inbound-tenant", "inbound", "outbound-global", "outbound", "delivery", "verified", "last-error"];
  const fields = new Map(ids.map((id) => [id, { textContent: "" }]));
  const parent = { postMessage(message: unknown, targetOrigin: string) {
    posts++;
    assert.equal((message as { message?: string }).message, "REQUEST_USER_DATA");
    assert.equal(targetOrigin, "https://app.gohighlevel.com");
    assert.equal(typeof handler, "function", "listener must be installed before request");
    const payload = CryptoJS.AES.encrypt(JSON.stringify({ userId: user }), secret).toString();
    handler?.({ source: {}, origin: "https://app.gohighlevel.com", data: { message: "REQUEST_USER_DATA_RESPONSE", payload } });
    handler?.({ source: parent, origin: "https://attacker.example", data: { message: "REQUEST_USER_DATA_RESPONSE", payload } });
    handler?.({ source: parent, origin: "https://app.gohighlevel.com", data: { message: "OTHER", payload } });
    handler?.({ source: parent, origin: "https://app.gohighlevel.com", data: { message: "REQUEST_USER_DATA_RESPONSE", payload } });
    handler?.({ source: parent, origin: "https://app.gohighlevel.com", data: { message: "REQUEST_USER_DATA_RESPONSE", payload } });
  } };
  vm.runInNewContext(script, {
    parent, location: { pathname: "/marketplace/gohighlevel/whatsapp-preview" },
    document: { createElement: () => ({ textContent: "" }), getElementById(id: string) {
      if (id === "loading") return loading;
      if (id === "details") return details;
      if (id === "error") return error;
      if (id === "requirements") return requirements;
      const field = fields.get(id); assert.ok(field); return field;
    } },
    addEventListener(type: string, callback: typeof handler) { assert.equal(type, "message"); handler = callback; },
    removeEventListener(type: string, callback: typeof handler) { if (type === "message" && handler === callback) handler = undefined; },
    setTimeout: () => 1, clearTimeout: () => undefined,
    fetch: async (url: string, options: { headers: Record<string, string>; cache: string; credentials: string }) => {
      fetches++;
      assert.equal(url, "/marketplace/gohighlevel/whatsapp-preview/status");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "same-origin");
      assert.ok(options.headers["X-GHL-Encrypted-Context"]);
      return { ok: true, json: async () => ({ success: true, location, status: expectedStatus }) };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posts, 1);
  assert.equal(fetches, 1);
  assert.equal(loading.hidden, true);
  assert.equal(details.hidden, false);
  assert.equal(fields.get("location")?.textContent, location);
  assert.equal(fields.get("provider-operation")?.textContent, "Not verified");
});

test("front-end exposes only an allowlisted error code and no response identity fields", async () => {
  const html = await (await createWhatsAppReadonlyCanary().request("https://preview.test/", {}, env())).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let handler: ((event: { source: unknown; origin: string; data: unknown }) => void) | undefined;
  const error = { textContent: "", hidden: true };
  const parent = { postMessage() {
    handler?.({ source: parent, origin: "https://app.gohighlevel.com", data: {
      message: "REQUEST_USER_DATA_RESPONSE", payload: CryptoJS.AES.encrypt("{}", secret).toString(),
    } });
  } };
  vm.runInNewContext(script, {
    parent, location: { pathname: "/marketplace/gohighlevel/whatsapp-preview" },
    document: { getElementById: (id: string) => id === "error" ? error : ({ hidden: false, textContent: "" }) },
    addEventListener: (_type: string, callback: typeof handler) => { handler = callback; },
    removeEventListener: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined,
    fetch: async () => ({ ok: false, json: async () => ({ success: false, errorCode: "COMPANY_NOT_ALLOWED", companyId: "private" }) }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(error.textContent, /COMPANY_NOT_ALLOWED/);
  assert.doesNotMatch(error.textContent, /private|companyId|\{/i);
});

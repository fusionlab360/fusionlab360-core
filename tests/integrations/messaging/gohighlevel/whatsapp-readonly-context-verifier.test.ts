import assert from "node:assert/strict";
import test from "node:test";
import CryptoJS from "crypto-js";
import { createApplication } from "../../../../src/bootstrap/routes";
import { createWhatsAppReadonlyCanary } from "../../../../src/integrations/messaging/gohighlevel/whatsapp-readonly-canary";

const sharedSecret = "synthetic-ghl-shared-secret";
const allowedOrigin = "https://waba-readonly-canary-fusionlab360-core.fusionlab360-official.workers.dev";
const tenant = "tenant_fixture";
const location = "location_approved";
const user = "user_approved";
const company = "company_fixture";
const appId = "marketplace_fixture";
const endpoint = "https://core.test/marketplace/gohighlevel/whatsapp-preview/verify-context";
const routerEndpoint = "https://core.test/verify-context";

function encryptedContext(changes: Record<string, unknown> = {}, key = sharedSecret): string {
  return CryptoJS.AES.encrypt(JSON.stringify({
    type: "location",
    role: "admin",
    appStatus: "live",
    userId: user,
    companyId: company,
    activeLocation: location,
    ...changes,
  }), key).toString();
}

function env(overrides: Record<string, unknown> = {}): never {
  return {
    APP_ENVIRONMENT: "production",
    WABA_GHL_CONTEXT_VERIFY_ENABLED: "true",
    WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN: allowedOrigin,
    WABA_GHL_READONLY_TENANT_ALLOWLIST: tenant,
    WABA_GHL_READONLY_LOCATION_ALLOWLIST: location,
    WABA_GHL_READONLY_USER_ALLOWLIST: user,
    WABA_GHL_READONLY_COMPANY_ALLOWLIST: company,
    WABA_GHL_READONLY_APP_ID: appId,
    WABA_GHL_READONLY_ENABLED: "false",
    GHL_APP_SHARED_SECRET: sharedSecret,
    DB: { prepare: () => { throw new Error("Unexpected D1 query"); } },
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
    provider_identifier: "must-not-be-returned",
    ...overrides,
  };
}

function readOnlyDb(row: Record<string, unknown> | null = installationRow()) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let writeAttempts = 0;
  const db = {
    prepare(sql: string) {
      assert.match(sql.trim(), /^SELECT\b/i, "Verifier D1 access must be SELECT-only");
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
      assert.doesNotMatch(sql, /SELECT\s+(?:credential\.(?:api_key|refresh_token|metadata)|credential\.\*)/i,
        "Verifier must not select credential values or raw metadata");
      return {
        bind(...values: unknown[]) {
          queries.push({ sql, values });
          return {
            all: async () => ({ results: row ? [row] : [] }),
            run: async () => { writeAttempts++; throw new Error("D1 write is forbidden in this fixture"); },
          };
        },
      };
    },
  };
  return { db, queries, get writeAttempts() { return writeAttempts; } };
}

function post(payload: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json", ...headers },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  };
}

test("valid encrypted context returns exactly the identity-only success contract", async () => {
  const fixture = readOnlyDb();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("External provider call is forbidden"); };
  try {
    const response = await createWhatsAppReadonlyCanary().request(routerEndpoint, post({ encryptedContext: encryptedContext() }), env({ DB: fixture.db }));
    assert.equal(response.status, 200);
    const result = await response.json() as Record<string, unknown>;
    assert.deepEqual(result, { verified: true, code: "CONTEXT_VERIFIED" });
    assert.deepEqual(Object.keys(result).sort(), ["code", "verified"]);
    assert.equal(fixture.queries.length, 1);
    assert.deepEqual(fixture.queries[0].values, [appId, company, location, location]);
    assert.equal(fixture.writeAttempts, 0);
    assert.equal(providerCalls, 0);
    assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);

    const agency = await createWhatsAppReadonlyCanary().request(
      routerEndpoint,
      post({ encryptedContext: encryptedContext({ type: "agency" }) }),
      env({ DB: fixture.db }),
    );
    assert.equal(agency.status, 200, "agency context must still be bound to the exact approved activeLocation");
    assert.deepEqual(await agency.json(), { verified: true, code: "CONTEXT_VERIFIED" });
    assert.equal(fixture.queries.length, 2);
    assert.equal(fixture.writeAttempts, 0);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing, malformed, undecryptable, and wrong user/company/location/app contexts fail with safe codes", async () => {
  const cases: Array<[unknown, Record<string, unknown>, string]> = [
    [undefined, {}, "CONTEXT_NOT_RECEIVED"],
    ["not-base64-context", {}, "CONTEXT_MALFORMED"],
    [encryptedContext({}, "different-secret"), {}, "CONTEXT_DECRYPT_FAILED"],
    [encryptedContext({ userId: "other-user" }), {}, "USER_NOT_ALLOWED"],
    [encryptedContext({ role: "user" }), {}, "USER_NOT_ALLOWED"],
    [encryptedContext({ companyId: "other-company" }), {}, "COMPANY_NOT_ALLOWED"],
    [encryptedContext({ activeLocation: "other-location" }), {}, "LOCATION_NOT_ALLOWED"],
    [encryptedContext({ appStatus: "draft" }), {}, "APP_NOT_ALLOWED"],
    [encryptedContext(), { WABA_GHL_READONLY_USER_ALLOWLIST: "other-user" }, "USER_NOT_ALLOWED"],
    [encryptedContext(), { WABA_GHL_READONLY_COMPANY_ALLOWLIST: "other-company" }, "COMPANY_NOT_ALLOWED"],
    [encryptedContext(), { WABA_GHL_READONLY_LOCATION_ALLOWLIST: "other-location" }, "LOCATION_NOT_ALLOWED"],
  ];
  for (const [encrypted, overrides, code] of cases) {
    const fixture = readOnlyDb();
    const response = await createWhatsAppReadonlyCanary().request(routerEndpoint, post(
      encrypted === undefined ? {} : { encryptedContext: encrypted },
    ), env({ ...overrides, DB: fixture.db }));
    assert.equal(response.status, 403, code);
    const result = await response.json() as Record<string, unknown>;
    assert.deepEqual(result, { verified: false, code });
    assert.equal(JSON.stringify(result).includes(sharedSecret), false);
    assert.equal(fixture.queries.length, 0, "identity claim failures must be rejected before database lookup");
  }
});

test("wrong tenant, app ownership, company/location ownership, and missing OAuth credential are denied", async () => {
  const cases: Array<[Record<string, unknown> | null, Record<string, unknown>, string]> = [
    [{ ...installationRow(), tenant_id: "another-tenant" }, {}, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), app_matches: 0 }, {}, "APP_NOT_ALLOWED"],
    [{ ...installationRow(), company_matches: 0 }, {}, "COMPANY_NOT_ALLOWED"],
    [{ ...installationRow(), location_matches: 0 }, {}, "LOCATION_NOT_ALLOWED"],
    [{ ...installationRow(), credential_auth_type: "api_key" }, {}, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), credential_configured: 0 }, {}, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), connected_metadata: 0 }, {}, "INSTALLATION_NOT_MATCHED"],
    [{ ...installationRow(), location_account_metadata: 0 }, {}, "INSTALLATION_NOT_MATCHED"],
    [null, {}, "INSTALLATION_NOT_MATCHED"],
    [installationRow(), { WABA_GHL_READONLY_TENANT_ALLOWLIST: "another-tenant" }, "INSTALLATION_NOT_MATCHED"],
  ];
  for (const [row, overrides, code] of cases) {
    const fixture = readOnlyDb(row);
    const response = await createWhatsAppReadonlyCanary().request(routerEndpoint, post({ encryptedContext: encryptedContext() }), env({ ...overrides, DB: fixture.db }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { verified: false, code });
    assert.equal(fixture.writeAttempts, 0);
  }
});

test("verifier is default-off, production-only, and requires the exact origin configuration", async () => {
  const app = createWhatsAppReadonlyCanary();
  const request = post({ encryptedContext: encryptedContext() });
  for (const overrides of [
    { WABA_GHL_CONTEXT_VERIFY_ENABLED: "false" },
    { WABA_GHL_CONTEXT_VERIFY_ENABLED: undefined },
    { APP_ENVIRONMENT: "preview" },
    { WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN: undefined },
    { WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN: "*" },
    { WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN: "https://example.test/path" },
    { GHL_APP_SHARED_SECRET: undefined },
  ]) {
    const response = await app.request(routerEndpoint, request, env(overrides));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { verified: false, code: "VERIFIER_UNAVAILABLE" });
  }
});

test("encrypted context is accepted only in the bounded JSON body, never query or header", async () => {
  const app = createWhatsAppReadonlyCanary();
  const encrypted = encryptedContext();
  const empty = await app.request(routerEndpoint, post(undefined), env());
  assert.equal(empty.status, 403);
  assert.deepEqual(await empty.json(), { verified: false, code: "CONTEXT_NOT_RECEIVED" });

  const malformedJson = await app.request(routerEndpoint, {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: "{",
  }, env());
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), { verified: false, code: "CONTEXT_MALFORMED" });

  const cases: Array<[string, RequestInit]> = [
    ["query", { ...post({ encryptedContext: encrypted }), body: undefined }],
    ["header", post({ encryptedContext: encrypted }, { "X-GHL-Encrypted-Context": encrypted })],
    ["content-type", { ...post({ encryptedContext: encrypted }), headers: { Origin: allowedOrigin, "Content-Type": "text/plain" } }],
    ["extra-body-field", post({ encryptedContext: encrypted, locationId: location })],
    ["oversized", { ...post({ encryptedContext: "x".repeat(9500) }) }],
  ];
  for (const [kind, init] of cases) {
    const url = kind === "query" ? `${routerEndpoint}?encryptedContext=${encodeURIComponent(encrypted)}` : routerEndpoint;
    const response = await app.request(url, init, env());
    assert.equal(response.status, 400, kind);
    const json = JSON.stringify(await response.json());
    assert.doesNotMatch(json, /encryptedContext|locationId|userId|companyId|secret|credential/i);
  }
});

test("CORS accepts only the approved Preview origin, POST, and content-type preflight", async () => {
  const app = createWhatsAppReadonlyCanary();
  const allowed = await app.request(routerEndpoint, {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  }, env());
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(allowed.headers.get("access-control-allow-methods"), "POST");
  assert.equal(allowed.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);

  for (const headers of [
    { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    { Origin: allowedOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    { Origin: allowedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type, authorization" },
    { Origin: allowedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "" },
  ]) {
    const response = await app.request(routerEndpoint, { method: "OPTIONS", headers }, env());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), { verified: false, code: headers.Origin === allowedOrigin ? "REQUEST_REJECTED" : "ORIGIN_NOT_ALLOWED" });
  }

  const noOrigin = await app.request(routerEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env());
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);

  const unsupportedMethod = await app.request(routerEndpoint, {
    method: "GET",
    headers: { Origin: allowedOrigin },
  }, env());
  assert.equal(unsupportedMethod.status, 405);
  assert.deepEqual(await unsupportedMethod.json(), { verified: false, code: "REQUEST_REJECTED" });
});

test("ownership lookup failures return a sanitized unavailable code", async () => {
  const db = { prepare: () => { throw new Error(`private ${sharedSecret} tenant=${tenant}`); } };
  const response = await createWhatsAppReadonlyCanary().request(
    routerEndpoint,
    post({ encryptedContext: encryptedContext() }),
    env({ DB: db }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { verified: false, code: "VERIFICATION_UNAVAILABLE" });
});

test("full Core application does not add wildcard CORS to the verifier and status route remains available", async () => {
  const app = createApplication("production");
  const fixture = readOnlyDb();
  const bindings = env({
    DB: fixture.db,
    JWT_SECRET: "synthetic-jwt-secret",
    JWT_ISSUER: "test-issuer",
    JWT_AUDIENCE: "test-audience",
  });
  const verified = await app.request(endpoint, post({ encryptedContext: encryptedContext() }), bindings);
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.notEqual(verified.headers.get("access-control-allow-origin"), "*");

  const disabledStatus = await app.request(
    "https://core.test/marketplace/gohighlevel/whatsapp-preview/status",
    { headers: { "X-GHL-Encrypted-Context": encryptedContext() } },
    env({ APP_ENVIRONMENT: "production", WABA_GHL_READONLY_ENABLED: "false" }),
  );
  assert.equal(disabledStatus.status, 404);
});

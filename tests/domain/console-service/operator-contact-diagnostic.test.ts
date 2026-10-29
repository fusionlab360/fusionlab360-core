import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import routes from "../../../src/domain/console-service/routes";
import { hashApiKey } from "../../../src/core/security/api-key";
import { sanitizeGHLLogUrl } from "../../../src/integrations/crm/gohighlevel/client";

class LocalD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => this.sqlite.prepare(sql).get(...values as never[]) as T | undefined ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  binding(): D1Database { return this as unknown as D1Database; }
}

test("GHL request diagnostics redact contact lookup values", () => {
  const sanitized = sanitizeGHLLogUrl("https://services.leadconnectorhq.com/contacts/lookup?locationId=location-a&phone=%2B60176177115");
  assert.equal(sanitized.includes("60176177115"), false);
  assert.equal(sanitized.includes("%5Bredacted%5D"), true);
});

function app() {
  const application = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  application.route("/internal/console", routes);
  return application;
}

async function fixture(options: { tenantId?: string; locationId?: string; enabled?: string; oauth?: boolean } = {}) {
  const db = new LocalD1();
  const key = "fl360_operator_contact_diagnostic_test_key";
  const tenantId = options.tenantId ?? "gmmetro";
  const locationId = options.locationId ?? "Npx2IdDDRjXz2QW3Svx4";
  const credential = options.oauth
    ? `INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id,refresh_token,access_token_expires_at) VALUES ('${tenantId}','gohighlevel','oauth2','expired-access','${locationId}','refresh-fixture',0);`
    : `INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id) VALUES ('${tenantId}','gohighlevel','api_key','synthetic-ghl-token','${locationId}');`;
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES ('${tenantId}','Synthetic Tenant','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('integration-a','${tenantId}','gohighlevel',1);
    ${credential}
    INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES ('console-client','${tenantId}','Console','${await hashApiKey(key)}','active','["contacts:read","integrations:test"]');
    INSERT INTO console_service_clients(client_id) VALUES ('console-client');
    INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','${tenantId}','contacts:read');
  `);
  return {
    db,
    key,
    env: {
      DB: db.binding(),
      GHL_OAUTH_CLIENT_ID: "synthetic-client",
      GHL_OAUTH_CLIENT_SECRET: "synthetic-secret",
      GHL_OAUTH_REDIRECT_URI: "https://example.test/oauth/callback",
      GHL_OPERATOR_CONTACT_DIAGNOSTIC_ENABLED: options.enabled,
      GHL_OPERATOR_CONTACT_DIAGNOSTIC_TENANT_ALLOWLIST: "gmmetro",
      GHL_OPERATOR_CONTACT_DIAGNOSTIC_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4",
      GHL_OPERATOR_CONTACT_DIAGNOSTIC_PHONE_E164: "+60176177115",
    } as AppBindings,
  };
}

test("operator contact diagnostic is fail-closed when disabled", async () => {
  const { db, key, env } = await fixture();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCount += 1; return new Response("{}", { status: 200 }); };
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 404);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("operator contact diagnostic requires the extra test permission", async () => {
  const { db, key, env } = await fixture({ enabled: "true" });
  db.sqlite.exec("UPDATE clients SET permissions='[\"contacts:read\"]'");
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 403);
  } finally {
    db.sqlite.close();
  }
});

test("operator contact diagnostic rejects an unauthenticated caller", async () => {
  const { db, env } = await fixture({ enabled: "true" });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST" }, env);
    assert.equal(response.status, 401);
  } finally {
    db.sqlite.close();
  }
});

test("operator contact diagnostic accepts a normal tenant API key without the Console service marker", async () => {
  const { db, key, env } = await fixture({ enabled: "true" });
  db.sqlite.exec("DELETE FROM console_service_clients; DELETE FROM client_tenant_grants WHERE client_id='console-client' AND tenant_id='gmmetro'");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ contacts: [{ id: "contact-a", locationId: "Npx2IdDDRjXz2QW3Svx4" }] }), { status: 200 });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { oauthAuthorized: true, refreshOutcome: "not_required", uniqueContactFound: true, locationMatched: true, callbackContactMatches: false, errorCode: null });
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("operator contact diagnostic rejects a same-client request when the fixed tenant allowlist differs", async () => {
  const { db, key, env } = await fixture({ enabled: "true" });
  env.GHL_OPERATOR_CONTACT_DIAGNOSTIC_TENANT_ALLOWLIST = "other-tenant";
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 404);
  } finally {
    db.sqlite.close();
  }
});

test("operator contact diagnostic returns sanitized unique-match result", async () => {
  const { db, key, env } = await fixture({ enabled: "true" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/contacts/lookup");
    assert.equal(url.searchParams.get("locationId"), "Npx2IdDDRjXz2QW3Svx4");
    assert.equal(url.searchParams.get("phone"), "+60176177115");
    return new Response(JSON.stringify({ contacts: [{ id: "contact-a", locationId: "Npx2IdDDRjXz2QW3Svx4" }] }), { status: 200 });
  };
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { oauthAuthorized: true, refreshOutcome: "not_required", uniqueContactFound: true, locationMatched: true, callbackContactMatches: false, errorCode: null });
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("operator contact diagnostic compares the lookup result to the fixed Test 005 callback identity", async () => {
  const { db, key, env } = await fixture({ enabled: "true" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ contacts: [{ id: "82Mbs4PR7MgyXh5uaqre", locationId: "Npx2IdDDRjXz2QW3Svx4" }] }), { status: 200 });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { oauthAuthorized: true, refreshOutcome: "not_required", uniqueContactFound: true, locationMatched: true, callbackContactMatches: true, errorCode: null });
    assert.equal(JSON.stringify(body).includes("82Mbs4PR7MgyXh5uaqre"), false);
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("operator contact diagnostic uses the normal OAuth refresh runtime when required", async () => {
  const { db, key, env } = await fixture({ enabled: "true", oauth: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
    }
    const requestUrl = new URL(url);
    assert.equal(requestUrl.pathname, "/contacts/lookup");
    return new Response(JSON.stringify({ contacts: [{ id: "contact-a", locationId: "Npx2IdDDRjXz2QW3Svx4" }] }), { status: 200 });
  };
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { oauthAuthorized: true, refreshOutcome: "completed", uniqueContactFound: true, locationMatched: true, callbackContactMatches: false, errorCode: null });
    const stored = db.sqlite.prepare("SELECT api_key, refresh_token FROM integration_credentials WHERE tenant_id='gmmetro' AND provider='gohighlevel'").get() as { api_key: string; refresh_token: string };
    assert.equal(stored.api_key, "refreshed-access");
    assert.equal(stored.refresh_token, "refreshed-refresh");
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("operator contact diagnostic rejects a caller-supplied phone or wrong location", async () => {
  const wrongBody = await fixture({ enabled: "true" });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${wrongBody.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+60123456789" }) }, wrongBody.env);
    assert.equal(response.status, 400);
  } finally {
    wrongBody.db.sqlite.close();
  }

  const wrongLocation = await fixture({ enabled: "true", locationId: "other-location" });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${wrongLocation.key}` } }, wrongLocation.env);
    assert.equal(response.status, 404);
  } finally {
    wrongLocation.db.sqlite.close();
  }

  const wrongTenant = await fixture({ enabled: "true", tenantId: "other-tenant" });
  try {
    const response = await app().request("/internal/console/diagnostics/gohighlevel/contact-lookup", { method: "POST", headers: { Authorization: `Bearer ${wrongTenant.key}` } }, wrongTenant.env);
    assert.equal(response.status, 404);
  } finally {
    wrongTenant.db.sqlite.close();
  }
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Hono } from "hono";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import { hashApiKey } from "../../../src/core/security/api-key";
import {
  ghlOAuthCallbackController,
  startGhlReconnectController,
} from "../../../src/domain/integration/oauth-controller";

const API_KEY = "fl360_gmmetro_reconnect_test_key";
const TENANT_ID = "gmmetro";
const OTHER_TENANT_ID = "other-tenant";
const CLIENT_ID = "client-gmmetro-reconnect";
const INTEGRATION_ID = "integration-gmmetro-reconnect";
const COMPANY_ID = "company-gmmetro";
const LOCATION_ID = "Npx2IdDDRjXz2QW3Svx4";
const REDIRECT_URI = "https://api.fusionlab360.com/oauth/gohighlevel/callback";
const PERMISSIONS = ["integrations:oauth:connect", "integrations:test"];

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
        const result = this.sqlite.prepare(sql).run(...bindings as never[]);
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() =>
        (this.sqlite.prepare(sql).get(...bindings as never[]) as T | undefined) ?? null,
      all: async <T>() => ({
        results: this.sqlite.prepare(sql).all(...bindings as never[]) as T[],
      }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  close(): void {
    this.sqlite.close();
  }
}

async function createDatabase(options: {
  tenantId?: string;
  permissions?: string[];
  locationId?: string;
  companyId?: string;
} = {}): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  const migrationFiles = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of migrationFiles) {
    database.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
  }

  const tenantId = options.tenantId ?? TENANT_ID;
  const locationId = options.locationId ?? LOCATION_ID;
  const companyId = options.companyId ?? COMPANY_ID;
  database.sqlite.prepare(
    "INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')",
  ).run(tenantId, "Synthetic gmmetro Tenant");
  database.sqlite.prepare(
    "INSERT INTO integrations (id, tenant_id, provider, enabled) VALUES (?, ?, 'gohighlevel', 1)",
  ).run(INTEGRATION_ID, tenantId);
  database.sqlite.prepare(`
    INSERT INTO integration_credentials (
      tenant_id, provider, auth_type, api_key, location_id, refresh_token, metadata
    ) VALUES (?, 'gohighlevel', 'oauth2', ?, ?, ?, ?)
  `).run(
    tenantId,
    "existing-location-token",
    locationId,
    "existing-location-refresh",
    JSON.stringify({
      accountType: "location",
      companyId,
      locationId,
      connectionStatus: "connected",
    }),
  );
  database.sqlite.prepare(`
    INSERT INTO clients (id, tenant_id, name, api_key_hash, status, permissions)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(
    CLIENT_ID,
    tenantId,
    "Synthetic reconnect client",
    await hashApiKey(API_KEY),
    JSON.stringify(options.permissions ?? PERMISSIONS),
  );
  return database;
}

function createApp(): Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}> {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.post("/reconnect", startGhlReconnectController);
  app.get("/callback", ghlOAuthCallbackController);
  return app;
}

function bindings(database: SqliteD1Database, scopes = "contacts.readonly conversations/message.readonly") {
  return {
    DB: database as unknown as D1Database,
    GHL_OAUTH_CLIENT_ID: "synthetic-app-client-id",
    GHL_OAUTH_CLIENT_SECRET: "synthetic-app-client-secret",
    GHL_OAUTH_REDIRECT_URI: REDIRECT_URI,
    GHL_OAUTH_SCOPES: scopes,
  } as AppBindings;
}

async function startReconnect(
  app: ReturnType<typeof createApp>,
  env: AppBindings,
  apiKey = API_KEY,
): Promise<Response> {
  return app.request("/reconnect", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env);
}

test("gmmetro reconnect creates a scoped state and persists refreshed credentials", async () => {
  const database = await createDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      return Response.json({
        access_token: "new-company-token",
        refresh_token: "new-company-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Company",
        companyId: COMPANY_ID,
        approvedLocations: [LOCATION_ID],
      });
    }
    if (url.endsWith("/oauth/location-token")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-company-token");
      return Response.json({
        access_token: "new-location-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Location",
        companyId: COMPANY_ID,
        locationId: LOCATION_ID,
        scope: "conversations/message.write",
      });
    }
    throw new Error("Unexpected provider request in reconnect test.");
  };

  try {
    const app = createApp();
    const env = bindings(database);
    const start = await startReconnect(app, env);
    const payload = await start.json() as { success: boolean; authorizationUrl: string; expiresAt: number };
    assert.equal(start.status, 200);
    assert.equal(payload.success, true);
    const state = new URL(payload.authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const stored = database.sqlite.prepare(
      "SELECT tenant_id, integration_id, purpose, context_json FROM oauth_authorization_states",
    ).get() as { tenant_id: string; integration_id: string; purpose: string; context_json: string };
    assert.equal(stored.tenant_id, TENANT_ID);
    assert.equal(stored.integration_id, INTEGRATION_ID);
    assert.equal(stored.purpose, "reconnect");
    assert.equal(
      stored.context_json,
      JSON.stringify({ companyId: COMPANY_ID, locationId: LOCATION_ID }),
    );

    const callback = await app.request(
      `/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    assert.equal(callback.status, 200);
    const replay = await app.request(
      `/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    assert.equal(replay.status, 400);
    const credential = database.sqlite.prepare(
      "SELECT api_key, refresh_token, metadata FROM integration_credentials WHERE tenant_id = ?",
    ).get(TENANT_ID) as { api_key: string; refresh_token: string; metadata: string };
    assert.equal(credential.api_key, "new-location-token");
    assert.equal(credential.refresh_token, "existing-location-refresh");
    assert.equal(JSON.parse(credential.metadata).connectionStatus, "connected");
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_authorization_states WHERE consumed_at IS NOT NULL").get()?.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("reconnect requires both permissions and rejects other tenants", async () => {
  const missingPermission = await createDatabase({ permissions: ["integrations:oauth:connect"] });
  const otherTenant = await createDatabase({ tenantId: OTHER_TENANT_ID, locationId: "other-location" });
  try {
    assert.equal((await startReconnect(createApp(), bindings(missingPermission), "")).status, 401);
    assert.equal((await startReconnect(createApp(), bindings(missingPermission))).status, 403);
    assert.equal((await startReconnect(createApp(), bindings(otherTenant))).status, 403);
    assert.equal(missingPermission.sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_authorization_states").get()?.count, 0);
    assert.equal(otherTenant.sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_authorization_states").get()?.count, 0);
  } finally {
    missingPermission.close();
    otherTenant.close();
  }
});

test("reconnect rejects the wrong location and an expired or replayed state", async () => {
  const wrongLocation = await createDatabase({ locationId: "wrong-location" });
  try {
    assert.equal((await startReconnect(createApp(), bindings(wrongLocation))).status, 409);
  } finally {
    wrongLocation.close();
  }

  const database = await createDatabase();
  try {
    const app = createApp();
    const env = bindings(database);
    const start = await startReconnect(app, env);
    const state = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state");
    assert.ok(state);
    database.sqlite.prepare("UPDATE oauth_authorization_states SET expires_at = ?").run(Date.now() - 1);
    const expired = await app.request(`/callback?code=code&state=${state}`, {}, env);
    assert.equal(expired.status, 400);
  } finally {
    database.close();
  }
});

test("reconnect callback rejects a mismatched Company before location synchronization", async () => {
  const database = await createDatabase();
  const originalFetch = globalThis.fetch;
  let locationCalled = false;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/oauth/token")) {
      return Response.json({
        access_token: "company-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Company",
        companyId: "wrong-company",
        approvedLocations: [LOCATION_ID],
      });
    }
    locationCalled = true;
    return Response.json({});
  };
  try {
    const app = createApp();
    const env = bindings(database);
    const start = await startReconnect(app, env);
    const state = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const callback = await app.request(`/callback?code=code&state=${state}`, {}, env);
    assert.equal(callback.status, 409);
    assert.equal(locationCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

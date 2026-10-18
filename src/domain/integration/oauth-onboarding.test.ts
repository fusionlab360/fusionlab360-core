import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Hono } from "hono";

import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../config/app";
import { hashApiKey } from "../../core/security/api-key";
import {
  ghlOAuthCallbackController,
  startGhlOAuthController,
} from "./oauth-controller";
import { OAuthInstallationRepository } from "../../persistence/repositories/oauth-installation-repository";

const API_KEY = "fl360_oauth_onboarding_test_key";
const TENANT_ID = "tenant-oauth-test";
const CLIENT_ID = "client-oauth-test";
const INTEGRATION_ID = "integration-oauth-test";
const COMPANY_ID = "company-oauth-test";
const LOCATION_ID = "location-oauth-test";
const REDIRECT_URI = "https://staging.example.test/oauth/gohighlevel/callback";
const ONBOARDING_SCOPE = "integrations:oauth:connect";

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
  permissions?: string[];
  tenantStatus?: "active" | "inactive";
  setupTenantId?: string;
} = {}): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  const migrationFiles = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of migrationFiles) {
    database.sqlite.exec(
      readFileSync(join(process.cwd(), "migrations", filename), "utf8"),
    );
  }

  const setupTenantId = options.setupTenantId ?? TENANT_ID;
  if (setupTenantId !== TENANT_ID) {
    database.sqlite.prepare(`
      INSERT INTO tenants (id, name, status)
      VALUES (?, ?, 'active')
    `).run(TENANT_ID, "Synthetic Authenticated Tenant");
  }
  database.sqlite.prepare(`
    INSERT INTO tenants (id, name, status)
    VALUES (?, ?, ?)
  `).run(setupTenantId, "Synthetic OAuth Tenant", options.tenantStatus ?? "inactive");
  database.sqlite.prepare(`
    INSERT INTO integrations (id, tenant_id, provider, enabled)
    VALUES (?, ?, 'gohighlevel', 0)
  `).run(INTEGRATION_ID, setupTenantId);
  database.sqlite.prepare(`
    INSERT INTO integration_credentials (
      tenant_id, provider, auth_type, api_key, location_id, metadata
    )
    VALUES (?, 'gohighlevel', 'oauth2', NULL, ?, ?)
  `).run(
    setupTenantId,
    LOCATION_ID,
    JSON.stringify({
      accountType: "location",
      companyId: COMPANY_ID,
      locationId: LOCATION_ID,
      connectionStatus: "pending_oauth",
    }),
  );
  database.sqlite.prepare(`
    INSERT INTO clients (id, tenant_id, name, api_key_hash, status, permissions)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(
    CLIENT_ID,
    TENANT_ID,
    "Synthetic OAuth Client",
    await hashApiKey(API_KEY),
    JSON.stringify(options.permissions ?? [ONBOARDING_SCOPE]),
  );

  return database;
}

function createApp(): Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}> {
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();
  app.post("/authorize", startGhlOAuthController);
  app.get("/callback", ghlOAuthCallbackController);
  return app;
}

function bindings(database: SqliteD1Database, options: {
  scopes?: string;
} = {}): AppBindings {
  return {
    DB: database as unknown as D1Database,
    GHL_OAUTH_CLIENT_ID: "synthetic-app-client-id",
    GHL_OAUTH_CLIENT_SECRET: "synthetic-app-client-secret",
    GHL_OAUTH_REDIRECT_URI: REDIRECT_URI,
    GHL_OAUTH_SCOPES: options.scopes ?? "contacts.readonly conversations/message.readonly",
  } as AppBindings;
}

async function startAuthorization(
  app: ReturnType<typeof createApp>,
  env: AppBindings,
  apiKey = API_KEY,
  body?: unknown,
): Promise<Response> {
  return app.request(
    "/authorize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

test("pending tenant OAuth initiation authenticates exact client, stores hashed state, and returns the provider URL", async () => {
  const database = await createDatabase();
  try {
    const app = createApp();
    const env = bindings(database);
    const response = await startAuthorization(app, env);
    const payload = await response.json() as {
      success: boolean;
      authorizationUrl: string;
      expiresAt: number;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    const url = new URL(payload.authorizationUrl);
    const state = url.searchParams.get("state");
    assert.ok(state);
    assert.equal(url.searchParams.get("client_id"), "synthetic-app-client-id");
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);

    const stored = database.sqlite.prepare(`
      SELECT state_hash, tenant_id, integration_id, provider, purpose, context_json, expires_at
      FROM oauth_authorization_states
    `).get() as {
      state_hash: string;
      tenant_id: string;
      integration_id: string;
      provider: string;
      purpose: string;
      context_json: string;
      expires_at: number;
    };
    assert.notEqual(stored.state_hash, state);
    assert.equal(stored.tenant_id, TENANT_ID);
    assert.equal(stored.integration_id, INTEGRATION_ID);
    assert.equal(stored.provider, "gohighlevel");
    assert.equal(stored.purpose, "connect");
    assert.deepEqual(JSON.parse(stored.context_json), {
      companyId: COMPANY_ID,
      locationId: LOCATION_ID,
    });
    assert.equal(stored.expires_at, payload.expiresAt);
  } finally {
    database.close();
  }
});

test("OAuth initiation rejects invalid credentials, missing exact scope, and active tenants", async () => {
  const invalidKeyDatabase = await createDatabase();
  try {
    const response = await startAuthorization(
      createApp(),
      bindings(invalidKeyDatabase),
      "fl360_invalid_key",
    );
    assert.equal(response.status, 401);
  } finally {
    invalidKeyDatabase.close();
  }

  const insufficientDatabase = await createDatabase({ permissions: ["*"] });
  try {
    const response = await startAuthorization(
      createApp(),
      bindings(insufficientDatabase),
    );
    assert.equal(response.status, 403);
  } finally {
    insufficientDatabase.close();
  }

  const activeDatabase = await createDatabase({ tenantStatus: "active" });
  try {
    const response = await startAuthorization(createApp(), bindings(activeDatabase));
    assert.equal(response.status, 409);
  } finally {
    activeDatabase.close();
  }
});

test("OAuth initiation fails closed when provider scopes are absent and ignores caller tenant IDs", async () => {
  const missingConfigDatabase = await createDatabase();
  try {
    const response = await startAuthorization(
      createApp(),
      bindings(missingConfigDatabase, { scopes: "" }),
    );
    assert.equal(response.status, 503);
    const states = missingConfigDatabase.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM oauth_authorization_states",
    ).get() as { count: number };
    assert.equal(states.count, 0);
  } finally {
    missingConfigDatabase.close();
  }

  const wrongTenantDatabase = await createDatabase({ setupTenantId: "other-tenant" });
  try {
    const response = await startAuthorization(
      createApp(),
      bindings(wrongTenantDatabase),
      API_KEY,
      { tenantId: "other-tenant" },
    );
    assert.equal(response.status, 409);
    const states = wrongTenantDatabase.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM oauth_authorization_states",
    ).get() as { count: number };
    assert.equal(states.count, 0);
  } finally {
    wrongTenantDatabase.close();
  }
});

test("OAuth initiation rejects ambiguous legacy Location ownership without creating authorization state", async () => {
  const database = await createDatabase();
  try {
    // Simulate a legacy database before the ownership migration was applied.
    database.sqlite.exec("DROP INDEX idx_credentials_ghl_location_owner");
    database.sqlite.exec("INSERT INTO tenants (id, name, status) VALUES ('another-tenant', 'Synthetic second tenant', 'inactive')");
    database.sqlite.prepare(`
      INSERT INTO integration_credentials (tenant_id, provider, auth_type, location_id)
      VALUES ('another-tenant', 'gohighlevel', 'oauth2', ?)
    `).run(LOCATION_ID);

    const response = await startAuthorization(createApp(), bindings(database));
    assert.equal(response.status, 503);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_authorization_states").get()?.count, 0);
    assert.equal(database.sqlite.prepare("SELECT status FROM tenants WHERE id = ?").get(TENANT_ID)?.status, "inactive");
  } finally {
    database.close();
  }
});

test("successful OAuth callback stores the location credential and activates only its pending tenant", async () => {
  const database = await createDatabase();
  const db = database as unknown as D1Database;
  const installationRepository = new OAuthInstallationRepository(db);
  const originalCompanyAccessToken = "existing-shared-company-token";
  await installationRepository.upsert({
    provider: "gohighlevel",
    accountType: "company",
    externalAccountId: COMPANY_ID,
    externalUserId: "existing-user",
    accessToken: originalCompanyAccessToken,
    refreshToken: "existing-refresh-token",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshLockToken: null,
    refreshLockExpiresAt: null,
    metadata: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;
  let locationTokenRequestAuthorization = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      return Response.json({
        access_token: "new-company-access-token",
        refresh_token: "new-company-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Company",
        companyId: COMPANY_ID,
        approvedLocations: [LOCATION_ID],
      });
    }
    if (url.endsWith("/oauth/location-token")) {
      locationTokenRequestAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        access_token: "new-location-access-token",
        refresh_token: "new-location-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Location",
        companyId: COMPANY_ID,
        locationId: LOCATION_ID,
      });
    }
    throw new Error("Unexpected provider request in test.");
  };

  try {
    const app = createApp();
    const env = bindings(database);
    const startResponse = await startAuthorization(app, env);
    const startPayload = await startResponse.json() as { authorizationUrl: string };
    const state = new URL(startPayload.authorizationUrl).searchParams.get("state");
    assert.ok(state);

    const callback = await app.request(
      `/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    const callbackBody = await callback.json() as { success: boolean };
    assert.equal(callback.status, 200);
    assert.equal(callbackBody.success, true);
    assert.equal(locationTokenRequestAuthorization, "Bearer new-company-access-token");

    const tenant = database.sqlite.prepare(
      "SELECT status FROM tenants WHERE id = ?",
    ).get(TENANT_ID) as { status: string };
    const integration = database.sqlite.prepare(
      "SELECT enabled FROM integrations WHERE id = ?",
    ).get(INTEGRATION_ID) as { enabled: number };
    const credential = database.sqlite.prepare(`
      SELECT auth_type, api_key, metadata
      FROM integration_credentials
      WHERE tenant_id = ? AND provider = 'gohighlevel'
    `).get(TENANT_ID) as {
      auth_type: string;
      api_key: string;
      metadata: string;
    };
    const sharedInstallation = await installationRepository.find(
      "gohighlevel",
      "company",
      COMPANY_ID,
    );

    assert.equal(tenant.status, "active");
    assert.equal(integration.enabled, 1);
    assert.equal(credential.auth_type, "oauth2");
    assert.equal(credential.api_key, "new-location-access-token");
    assert.equal(JSON.parse(credential.metadata).connectionStatus, "connected");
    assert.equal(sharedInstallation?.accessToken, originalCompanyAccessToken);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("mismatched provider Location response does not store credentials or activate tenant", async () => {
  const database = await createDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/oauth/token")) {
      return Response.json({
        access_token: "company-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Company",
        companyId: COMPANY_ID,
        approvedLocations: [LOCATION_ID],
      });
    }
    if (String(input).endsWith("/oauth/location-token")) {
      return Response.json({
        access_token: "wrong-location-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Location",
        companyId: COMPANY_ID,
        locationId: "another-location",
      });
    }
    throw new Error("Unexpected provider request in test.");
  };

  try {
    const app = createApp();
    const env = bindings(database);
    const startResponse = await startAuthorization(app, env);
    const startPayload = await startResponse.json() as { authorizationUrl: string };
    const state = new URL(startPayload.authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const callback = await app.request(
      `/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    assert.equal(callback.status, 500);

    const tenant = database.sqlite.prepare(
      "SELECT status FROM tenants WHERE id = ?",
    ).get(TENANT_ID) as { status: string };
    const integration = database.sqlite.prepare(
      "SELECT enabled FROM integrations WHERE id = ?",
    ).get(INTEGRATION_ID) as { enabled: number };
    const credential = database.sqlite.prepare(`
      SELECT api_key, metadata
      FROM integration_credentials
      WHERE tenant_id = ? AND provider = 'gohighlevel'
    `).get(TENANT_ID) as { api_key: string | null; metadata: string };

    assert.equal(tenant.status, "inactive");
    assert.equal(integration.enabled, 0);
    assert.equal(credential.api_key, null);
    assert.equal(JSON.parse(credential.metadata).connectionStatus, "pending_oauth");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("mismatched Company identity is rejected before Location synchronization", async () => {
  const database = await createDatabase();
  const originalFetch = globalThis.fetch;
  let locationRequestMade = false;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/oauth/token")) {
      return Response.json({
        access_token: "company-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        userType: "Company",
        companyId: "different-company",
        approvedLocations: [LOCATION_ID],
      });
    }
    locationRequestMade = true;
    return Response.json({});
  };

  try {
    const app = createApp();
    const env = bindings(database);
    const startResponse = await startAuthorization(app, env);
    const startPayload = await startResponse.json() as { authorizationUrl: string };
    const state = new URL(startPayload.authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const callback = await app.request(
      `/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    assert.equal(callback.status, 409);
    assert.equal(locationRequestMade, false);

    const tenant = database.sqlite.prepare(
      "SELECT status FROM tenants WHERE id = ?",
    ).get(TENANT_ID) as { status: string };
    const credential = database.sqlite.prepare(`
      SELECT api_key
      FROM integration_credentials
      WHERE tenant_id = ? AND provider = 'gohighlevel'
    `).get(TENANT_ID) as { api_key: string | null };
    assert.equal(tenant.status, "inactive");
    assert.equal(credential.api_key, null);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

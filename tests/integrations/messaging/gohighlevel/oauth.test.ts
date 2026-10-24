import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { ghlOAuthCallbackController } from "../../../../src/domain/integration/oauth-controller";
import {
  buildGHLAuthorizationUrl,
  exchangeGHLAuthorizationCode,
  GHLInvalidGrantError,
  isGHLInvalidGrantError,
  refreshGHLCompanyAccessToken,
  refreshGHLLocationAccessToken,
  requestGHLReconnectAuthorizationCode,
} from "../../../../src/integrations/messaging/gohighlevel/oauth";

const stagingRedirectUri = "https://staging.example.test/oauth/gohighlevel/callback";
const productionRedirectUri = "https://api.fusionlab360.com/oauth/gohighlevel/callback";
const sensitiveProviderText = "OAUTH_PROVIDER_PRIVATE_SENTINEL";

function callbackDatabase(): D1Database {
  const stateRow = {
    tenant_id: "tenant-fixture",
    integration_id: "integration-fixture",
    provider: "gohighlevel",
    purpose: "connect",
    context_json: JSON.stringify({
      companyId: "company-fixture",
      locationId: "location-fixture",
    }),
    expires_at: Date.now() + 60_000,
  };

  return {
    prepare(sql: string) {
      const statement = {
        bind: () => statement,
        run: async () => ({ meta: { changes: 1 } }),
        first: async <T>() => {
          if (sql.includes("FROM oauth_authorization_states")) {
            return stateRow as T;
          }
          if (sql.includes("FROM tenants t")) {
            return {
              tenant_status: "inactive",
              integration_id: "integration-fixture",
              provider: "gohighlevel",
              integration_enabled: 0,
              credential_auth_type: "oauth2",
              credential_has_token: 0,
              location_id: "location-fixture",
              credential_metadata: JSON.stringify({
                accountType: "location",
                companyId: "company-fixture",
                locationId: "location-fixture",
                connectionStatus: "pending_oauth",
              }),
            } as T;
          }
          return null;
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

test("authorization URL uses the configured app, callback, scopes, and state", () => {
  const state = "a".repeat(64);
  const url = new URL(buildGHLAuthorizationUrl({
    GHL_OAUTH_CLIENT_ID: "client-fixture",
    GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
    GHL_OAUTH_SCOPES: "contacts.readonly, conversations/message.readonly",
  }, state));

  assert.equal(url.origin, "https://marketplace.gohighlevel.com");
  assert.equal(url.pathname, "/v2/oauth/chooselocation");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-fixture");
  assert.equal(url.searchParams.get("redirect_uri"), stagingRedirectUri);
  assert.equal(
    url.searchParams.get("scope"),
    "contacts.readonly conversations/message.readonly",
  );
  assert.equal(url.searchParams.get("state"), state);
});

test("authorization URL generation fails closed without explicit scopes", () => {
  assert.throws(
    () => buildGHLAuthorizationUrl({
      GHL_OAUTH_CLIENT_ID: "client-fixture",
      GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
    }, "a".repeat(64)),
    /GHL_OAUTH_SCOPES is not configured/,
  );
});

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: "access-token-fixture",
    token_type: "Bearer",
    companyId: "company-fixture",
    ...overrides,
  });
}

async function withFetch<T>(
  handler: typeof fetch,
  action: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("authorization-code exchange uses the explicitly configured callback URI", async () => {
  let requestBody = "";

  await withFetch(
    async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return tokenResponse();
    },
    async () => {
      await exchangeGHLAuthorizationCode(
        {
          GHL_OAUTH_CLIENT_ID: "client-fixture",
          GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
          GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
        },
        "code-fixture",
      );
    },
  );

  assert.equal(new URLSearchParams(requestBody).get("redirect_uri"), stagingRedirectUri);
});

test("missing callback configuration fails closed before token exchange", async () => {
  let fetchCalled = false;

  await withFetch(
    async () => {
      fetchCalled = true;
      return tokenResponse();
    },
    async () => {
      await assert.rejects(
        exchangeGHLAuthorizationCode(
          {
            GHL_OAUTH_CLIENT_ID: "client-fixture",
            GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
          },
          "code-fixture",
        ),
        /GHL_OAUTH_REDIRECT_URI is not configured/,
      );
    },
  );

  assert.equal(fetchCalled, false);
});

test("reconnect fails closed before contacting the provider without callback configuration", async () => {
  let fetchCalled = false;

  await withFetch(
    async () => {
      fetchCalled = true;
      return Response.json({ authorizationCode: "code-fixture" });
    },
    async () => {
      await assert.rejects(
        requestGHLReconnectAuthorizationCode(
          {
            GHL_OAUTH_CLIENT_ID: "client-fixture",
            GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
          },
          { userType: "Company", companyId: "company-fixture" },
        ),
        /GHL_OAUTH_REDIRECT_URI is not configured/,
      );
    },
  );

  assert.equal(fetchCalled, false);
});

test("production callback configuration preserves the existing URI", async () => {
  let requestBody = "";

  await withFetch(
    async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return tokenResponse();
    },
    async () => {
      await exchangeGHLAuthorizationCode(
        {
          GHL_OAUTH_CLIENT_ID: "client-fixture",
          GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
          GHL_OAUTH_REDIRECT_URI: productionRedirectUri,
        },
        "code-fixture",
      );
    },
  );

  assert.equal(new URLSearchParams(requestBody).get("redirect_uri"), productionRedirectUri);
});

test("company and location token refresh use their configured callback URI", async () => {
  const requestBodies: string[] = [];

  await withFetch(
    async (_input, init) => {
      requestBodies.push(String(init?.body ?? ""));
      return tokenResponse({ userType: "Location", locationId: "location-fixture" });
    },
    async () => {
      const env = {
        GHL_OAUTH_CLIENT_ID: "client-fixture",
        GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
        GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
      };
      await refreshGHLCompanyAccessToken(env, "refresh-fixture");
      await refreshGHLLocationAccessToken(env, "refresh-fixture");
    },
  );

  assert.equal(requestBodies.length, 2);
  for (const body of requestBodies) {
    assert.equal(new URLSearchParams(body).get("redirect_uri"), stagingRedirectUri);
  }
});

test("token endpoint response body is excluded from errors while invalid_grant remains classified", async () => {
  await withFetch(
    async () => Response.json(
      { error: "invalid_grant", error_description: sensitiveProviderText },
      { status: 400 },
    ),
    async () => {
      await assert.rejects(
        exchangeGHLAuthorizationCode(
          {
            GHL_OAUTH_CLIENT_ID: "client-fixture",
            GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
            GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
          },
          "code-fixture",
        ),
        (error: unknown) => {
          assert.ok(error instanceof GHLInvalidGrantError);
          assert.equal(isGHLInvalidGrantError(error), true);
          assert.equal(error.message.includes(sensitiveProviderText), false);
          assert.match(error.message, /\(400\)/);
          return true;
        },
      );
    },
  );
});

test("reconnect endpoint response body is excluded from errors", async () => {
  await withFetch(
    async () => Response.json(
      { message: sensitiveProviderText },
      { status: 503 },
    ),
    async () => {
      await assert.rejects(
        requestGHLReconnectAuthorizationCode(
          {
            GHL_OAUTH_CLIENT_ID: "client-fixture",
            GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
            GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
          },
          { userType: "Company", companyId: "company-fixture" },
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(sensitiveProviderText), false);
          assert.match(error.message, /\(503\)/);
          return true;
        },
      );
    },
  );
});

test("OAuth denial callback does not echo provider-controlled error details", async () => {
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();
  app.get("/callback", ghlOAuthCallbackController);

  const response = await app.request(
    `/callback?error=access_denied&error_description=${encodeURIComponent(sensitiveProviderText)}&state=${"a".repeat(64)}`,
    {},
    { DB: callbackDatabase() } as AppBindings,
  );
  const responseText = await response.text();

  assert.equal(response.status, 400);
  assert.equal(responseText.includes(sensitiveProviderText), false);
  assert.match(responseText, /authorization was not completed/i);
});

test("OAuth callback failure logs and returns a safe classification", async () => {
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();
  app.get("/callback", ghlOAuthCallbackController);

  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logEntries: unknown[][] = [];
  globalThis.fetch = async () => Response.json(
    { error: "invalid_grant", error_description: sensitiveProviderText },
    { status: 400 },
  );
  console.error = (...args: unknown[]) => logEntries.push(args);

  try {
    const response = await app.request(
      `/callback?code=code-fixture&state=${"b".repeat(64)}`,
      {},
      {
        DB: callbackDatabase(),
        GHL_OAUTH_CLIENT_ID: "client-fixture",
        GHL_OAUTH_CLIENT_SECRET: "secret-fixture",
        GHL_OAUTH_REDIRECT_URI: stagingRedirectUri,
      } as AppBindings,
    );
    const responseText = await response.text();
    const logText = JSON.stringify(logEntries);

    assert.equal(response.status, 500);
    assert.equal(responseText.includes(sensitiveProviderText), false);
    assert.equal(logText.includes(sensitiveProviderText), false);
    assert.match(logText, /invalid_grant/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

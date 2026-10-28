import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import type { RequestContext } from "../../../../src/context/types";
import integrationRoutes from "../../../../src/domain/integration/routes";
import {
  GHL_PROVIDER_INSPECTION_ID,
  GHL_PROVIDER_INSPECTION_LOCATION,
} from "../../../../src/integrations/messaging/gohighlevel/provider-inspection";

function fixture(options: {
  enabled?: boolean;
  tenantId?: string;
  locationId?: string;
  permissions?: string[];
  body?: unknown;
  status?: number;
  refreshOnUnauthorized?: boolean;
} = {}) {
  const tenantId = options.tenantId ?? "gmmetro";
  const locationId = options.locationId ?? GHL_PROVIDER_INSPECTION_LOCATION;
  const permissions = options.permissions ?? ["contacts:read", "integrations:test"];
  const resolveCalls: Array<{ forceRefresh?: boolean }> = [];
  let fetchCalls = 0;
  const resolve = async (request: { forceRefresh?: boolean }) => {
    resolveCalls.push(request);
    return {
      authType: "oauth2" as const,
      accessToken: request.forceRefresh ? "rotated-token" : "initial-token",
      resourceId: locationId,
    };
  };
  const context = {
    client: { id: "gmmetro-client", tenantId, permissions },
    tenant: {
      id: tenantId,
      name: tenantId,
      status: "active" as const,
      integrations: {
        crm: {
          id: "gmmetro-crm",
          provider: "gohighlevel" as const,
          credentials: { locationId },
          configuration: null,
        },
        pms: { provider: "browser" as const },
      },
    },
    requestId: "provider-inspection-test",
    receivedAt: new Date(),
    integrationRuntime: {
      transportMode: "mock" as const,
      credentials: { resolve },
      httpTransport: {
        credentials: { resolve },
        fetch: async (_input: RequestInfo | URL, _init?: RequestInit) => {
          fetchCalls += 1;
          if (options.refreshOnUnauthorized && fetchCalls === 1) {
            return Response.json({ message: "sensitive upstream detail" }, { status: 401 });
          }
          return Response.json(options.body ?? {
            conversationChannel: {
              SMS: [{
                conversationProvider: {
                  _id: GHL_PROVIDER_INSPECTION_ID,
                  type: "SMS",
                  isCustomConversationProvider: true,
                },
              }],
            },
          }, { status: options.status ?? 200 });
        },
      },
    },
  } as unknown as RequestContext;

  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("context", context);
    c.set("principal", {
      type: "client",
      clientId: "gmmetro-client",
      tenantId,
      permissions,
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations", integrationRoutes);

  return {
    app,
    env: { GHL_OPERATOR_PROVIDER_INSPECTION_ENABLED: options.enabled ? "true" : "false" } as AppBindings,
    resolveCalls,
    getFetchCalls: () => fetchCalls,
  };
}

const path = "/integrations/gohighlevel/provider-inspection";

test("provider inspection returns only safe matching-provider metadata", async () => {
  const f = fixture({ enabled: true });
  const response = await f.app.request(path, {}, f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    lookupSucceeded: true,
    expectedProviderPresent: true,
    registeredChannelType: "SMS",
    customProviderFlag: true,
    providerOwnershipVerified: null,
    errorCode: null,
  });
});

test("provider inspection fails closed when disabled or outside gmmetro", async () => {
  const disabled = fixture();
  assert.equal((await disabled.app.request(path, {}, disabled.env)).status, 404);
  assert.equal(disabled.getFetchCalls(), 0);

  const wrongTenant = fixture({ enabled: true, tenantId: "other-tenant" });
  assert.equal((await wrongTenant.app.request(path, {}, wrongTenant.env)).status, 404);
  assert.equal(wrongTenant.getFetchCalls(), 0);
});

test("provider inspection requires contacts:read and integrations:test", async () => {
  const missingContacts = fixture({ enabled: true, permissions: ["integrations:test"] });
  assert.equal((await missingContacts.app.request(path, {}, missingContacts.env)).status, 403);
  const missingTest = fixture({ enabled: true, permissions: ["contacts:read"] });
  assert.equal((await missingTest.app.request(path, {}, missingTest.env)).status, 403);
});

test("provider inspection distinguishes absent and malformed responses", async () => {
  const absent = fixture({ enabled: true, body: { conversationChannel: { SMS: [] } } });
  assert.deepEqual(await (await absent.app.request(path, {}, absent.env)).json(), {
    lookupSucceeded: true,
    expectedProviderPresent: false,
    registeredChannelType: null,
    customProviderFlag: null,
    providerOwnershipVerified: null,
    errorCode: "provider_not_found",
  });

  const malformed = fixture({ enabled: true, body: { secret: "must not be returned" } });
  const malformedResponse = await malformed.app.request(path, {}, malformed.env);
  assert.deepEqual(await malformedResponse.json(), {
    lookupSucceeded: false,
    expectedProviderPresent: false,
    registeredChannelType: null,
    customProviderFlag: null,
    providerOwnershipVerified: null,
    errorCode: "malformed_response",
  });
});

test("provider inspection uses the existing OAuth refresh path", async () => {
  const f = fixture({ enabled: true, refreshOnUnauthorized: true });
  const response = await f.app.request(path, {}, f.env);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { lookupSucceeded?: unknown }).lookupSucceeded, true);
  assert.equal(f.getFetchCalls(), 2);
  assert.equal(f.resolveCalls.some((call) => call.forceRefresh === true), true);
});

test("provider inspection sanitizes upstream failures", async () => {
  const f = fixture({ enabled: true, status: 400, body: {
    message: "private provider list and token detail",
    token: "secret",
  } });
  const response = await f.app.request(path, {}, f.env);
  const result = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 502);
  assert.equal(result.errorCode, "upstream_http_error");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

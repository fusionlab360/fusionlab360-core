import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import type { RequestContext } from "../../../../src/context/types";
import { integrationTestRoutes } from "../../../../src/domain/integration/routes";

function createApp(
  tenantId = "gmmetro",
  locationId = "Npx2IdDDRjXz2QW3Svx4",
  permissions = ["integrations:test"],
  upstreamStatus = 200,
) {
  let upstreamCalls = 0;
  const resolve = async () => ({
    authType: "oauth2" as const,
    accessToken: "synthetic-access-token",
    resourceId: locationId,
  });
  const context = {
    client: { id: `client-${tenantId}`, tenantId, permissions },
    tenant: {
      id: tenantId,
      name: tenantId,
      status: "active" as const,
      integrations: {
        crm: {
          id: `${tenantId}-crm`,
          provider: "gohighlevel" as const,
          credentials: { locationId },
          configuration: null,
        },
        pms: { provider: "browser" as const },
      },
    },
    requestId: "request-test",
    receivedAt: new Date(),
    integrationRuntime: {
      transportMode: "mock" as const,
      credentials: { resolve },
      httpTransport: {
        credentials: { resolve },
        fetch: async () => {
          upstreamCalls += 1;
          if (upstreamStatus === 200) {
            return Response.json({ conversations: [] });
          }
          return Response.json({ message: "synthetic provider detail" }, { status: upstreamStatus });
        },
      },
    },
  } as unknown as RequestContext;

  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("context", context);
    c.set("principal", {
      type: "client",
      clientId: `client-${tenantId}`,
      tenantId,
      permissions,
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations", integrationTestRoutes);

  return {
    app,
    getUpstreamCalls: () => upstreamCalls,
  };
}

const path = "/integrations/gohighlevel/oauth/verify-location";

test("location OAuth diagnostic returns only safe success metadata", async () => {
  const fixture = createApp();
  const response = await fixture.app.request(path, {}, {} as AppBindings);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    upstreamHttpStatus: 200,
    errorCategory: null,
    requestedScope: "conversations.readonly",
  });
  assert.equal(fixture.getUpstreamCalls(), 1);
});

test("location OAuth diagnostic classifies upstream authorization failures safely", async () => {
  const fixture = createApp("gmmetro", "Npx2IdDDRjXz2QW3Svx4", ["integrations:test"], 401);
  const response = await fixture.app.request(path, {}, {} as AppBindings);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: false,
    upstreamHttpStatus: 401,
    errorCategory: "upstream_authorization",
    requestedScope: "conversations.readonly",
  });
});

test("location OAuth diagnostic is unavailable outside the approved pilot tenant/location", async () => {
  const wrongTenant = createApp("other-tenant");
  const wrongTenantResponse = await wrongTenant.app.request(path, {}, {} as AppBindings);
  assert.equal(wrongTenantResponse.status, 404);
  assert.equal(wrongTenant.getUpstreamCalls(), 0);

  const wrongLocation = createApp("gmmetro", "other-location");
  const wrongLocationResponse = await wrongLocation.app.request(path, {}, {} as AppBindings);
  assert.equal(wrongLocationResponse.status, 404);
  assert.equal(wrongLocation.getUpstreamCalls(), 0);
});

test("location OAuth diagnostic still requires integrations:test", async () => {
  const fixture = createApp("gmmetro", "Npx2IdDDRjXz2QW3Svx4", ["integrations:read"]);
  const response = await fixture.app.request(path, {}, {} as AppBindings);

  assert.equal(response.status, 403);
  assert.equal(fixture.getUpstreamCalls(), 0);
});

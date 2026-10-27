import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { RequestContext } from "../../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import { integrationPilotRoutes } from "../../../../src/domain/integration/routes";

function createApp(permissions: string[]) {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    const tenantId = "gmmetro";
    c.set("context", {
      client: { id: "client-gmmetro", tenantId, permissions },
      tenant: {
        id: tenantId,
        name: tenantId,
        status: "active",
        integrations: {
          crm: {
            id: "gmmetro-crm",
            provider: "gohighlevel",
            credentials: { locationId: "Npx2IdDDRjXz2QW3Svx4" },
            configuration: null,
          },
          pms: { provider: "browser" },
        },
      },
      requestId: "request-test",
      receivedAt: new Date(),
      integrationRuntime: {},
    } as unknown as RequestContext);
    c.set("principal", {
      type: "client",
      clientId: "client-gmmetro",
      tenantId,
      permissions,
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations", integrationPilotRoutes);
  return app;
}

test("controlled test inbound remains closed when the pilot flag is disabled", async () => {
  const app = createApp(["integrations:test"]);
  const response = await app.request(
    "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
    { method: "POST", body: JSON.stringify({ contactId: "synthetic-contact", message: "synthetic", idempotencyKey: "m0-test-1" }) },
    {} as AppBindings,
  );
  assert.equal(response.status, 404);
});
test("controlled test inbound requires the dedicated operator permission", async () => {
  const app = createApp(["integrations:read"]);
  const response = await app.request(
    "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
    { method: "POST", body: JSON.stringify({ contactId: "synthetic-contact", message: "synthetic", idempotencyKey: "m0-test-2" }) },
    { GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4" } as AppBindings,
  );
  assert.equal(response.status, 403);
});
// End of focused route test.

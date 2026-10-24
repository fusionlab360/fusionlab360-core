import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type { AppBindings, AppVariables } from "../../src/config/app";
import type { RequestContext } from "../../src/context/types";
import type { AuthenticatedPrincipal } from "../../src/core/security/principal";
import { authenticateApiKey } from "../../src/middleware/providers/api-key";
import messagingTestRoutes from "../../src/domain/messaging/test-routes";
import { requirePermission } from "../../src/middleware/authorization";

const authenticatedClient = {
  id: "client-a",
  name: "Client A",
  tenant_id: "tenant-a",
  api_key_hash: "validated-hash",
  status: "active",
  permissions: JSON.stringify(["messaging:test", "reservations:sync"]),
};

function fakeClientDb(clientRecord: typeof authenticatedClient | null) {
  return {
    prepare() {
      const statement = {
        bind() { return statement; },
        async first<T>() {
          return clientRecord as unknown as T | null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function createPermissionApp(options: {
  clientId?: string;
  clientTenantId?: string;
  principalClientId?: string;
  principalTenantId?: string;
  clientPermissions?: string[];
  principalPermissions?: readonly string[];
}) {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    const tenantId = options.clientTenantId ?? "tenant-a";
    const clientId = options.clientId ?? "client-a";
    c.set("context", {
      client: {
        id: clientId,
        tenantId,
        permissions: options.clientPermissions ?? ["reservations:sync"],
      },
      tenant: { id: tenantId },
    } as unknown as RequestContext);
    c.set("principal", {
      type: "client",
      clientId: options.principalClientId ?? clientId,
      tenantId: options.principalTenantId ?? tenantId,
      permissions: options.principalPermissions ?? ["reservations:sync"],
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.post("/reservations/sync", requirePermission("reservations:sync"), (c) =>
    c.json({ success: true }),
  );
  app.route("/messaging-test", messagingTestRoutes);
  return app;
}

test("authenticated API key resolves permissions from its client record", async () => {
  const result = await authenticateApiKey(fakeClientDb(authenticatedClient), "fl360_valid");
  assert.equal(result.principal.clientId, "client-a");
  assert.equal(result.principal.tenantId, "tenant-a");
  assert.deepEqual(result.principal.permissions, ["messaging:test", "reservations:sync"]);
});

test("invalid API key is rejected by client authentication", async () => {
  await assert.rejects(
    authenticateApiKey(fakeClientDb(null), "fl360_invalid"),
    /Invalid API client/,
  );
});

test("client with required permission can call an integration operation", async () => {
  const app = createPermissionApp({});
  const response = await app.request("/reservations/sync", { method: "POST" });
  assert.equal(response.status, 200);
});

test("client without the operation permission is denied", async () => {
  const app = createPermissionApp({
    clientPermissions: ["reservations:read"],
    principalPermissions: ["reservations:read"],
  });
  const response = await app.request("/reservations/sync", { method: "POST" });
  assert.equal(response.status, 403);
});

test("client and tenant identity must match the authenticated principal", async () => {
  const wrongClientApp = createPermissionApp({ principalClientId: "client-b" });
  const wrongTenantApp = createPermissionApp({ principalTenantId: "tenant-b" });

  assert.equal((await wrongClientApp.request("/reservations/sync", { method: "POST" })).status, 401);
  assert.equal((await wrongTenantApp.request("/reservations/sync", { method: "POST" })).status, 401);
});

test("mounted messaging test endpoint denies callers without test permission", async () => {
  const app = createPermissionApp({
    clientPermissions: ["messaging:read"],
    principalPermissions: ["messaging:read"],
  });
  const response = await app.request(
    "/messaging-test/conversations/conversation-a/messages",
  );
  assert.equal(response.status, 403);
});

test("caller-supplied identity and permission headers cannot grant missing scopes", async () => {
  const app = createPermissionApp({
    clientPermissions: ["reservations:read"],
    principalPermissions: ["reservations:read"],
  });
  const response = await app.request("/reservations/sync", {
    method: "POST",
    headers: {
      "x-tenant-id": "tenant-b",
      "x-client-id": "client-b",
      "x-permissions": "*",
    },
  });
  assert.equal(response.status, 403);
});


import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "hono";

import { authRoutes } from "../../../src/domain/auth/routes";
import { me } from "../../../src/domain/auth/controller";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";

function contextFor(principal?: AuthenticatedPrincipal): Context {
  return {
    get(name: string) {
      return name === "principal" ? principal : undefined;
    },
    json(value: unknown, status = 200) {
      return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  } as unknown as Context;
}

test("GET /auth/me requires bearer authentication", async () => {
  const response = await authRoutes.request("/me");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "Unauthorized.",
  });
});

test("/auth/me returns only identity claims from an authenticated user principal", async () => {
  const principal = {
    type: "user",
    userId: "user-a",
    tenantId: "tenant-a",
    clientId: "client-a",
    role: "admin",
    permissions: ["integrations:read"],
    email: "private@example.invalid",
    refreshToken: "private-refresh-token",
  } as unknown as AuthenticatedPrincipal;
  const response = await me(contextFor(principal));

  assert.deepEqual(await response.json(), {
    id: "user-a",
    tenantId: "tenant-a",
    clientId: "client-a",
    role: "admin",
    permissions: ["integrations:read"],
  });
});

test("/auth/me denies client principals even when they have a client ID", async () => {
  const response = await me(contextFor({
    type: "client",
    tenantId: "tenant-a",
    clientId: "client-a",
    permissions: ["*"],
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "Forbidden.",
  });
});

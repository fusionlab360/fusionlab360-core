
import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../../src/config/app";
import type { RequestContext } from "../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";

import featureRoutes from "../../../src/domain/features/routes";

function createFakeDb() {
  const settings = new Map<string, number>();

  const db = {
    prepare(_sql: string) {
      let values: unknown[] = [];

      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },

        async all() {
          const tenantId = values[0];

          if (typeof tenantId !== "string") {
            throw new Error("Expected tenant ID.");
          }

          const prefix = `${tenantId}::`;

          return {
            results: [...settings.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, enabled]) => ({
                feature_key: key.slice(prefix.length),
                enabled,
              })),
          };
        },

        async first<T>() {
          const [tenantId, featureKey] = values;

          if (
            typeof tenantId !== "string" ||
            typeof featureKey !== "string"
          ) {
            throw new Error("Invalid setting lookup.");
          }

          const enabled = settings.get(
            `${tenantId}::${featureKey}`,
          );

          return (
            enabled === undefined
              ? null
              : { enabled }
          ) as unknown as T | null;
        },

        async run() {
          const [tenantId, featureKey, enabled] = values;

          if (
            typeof tenantId !== "string" ||
            typeof featureKey !== "string" ||
            typeof enabled !== "number"
          ) {
            throw new Error("Invalid setting update.");
          }

          settings.set(
            `${tenantId}::${featureKey}`,
            enabled,
          );

          return {
            success: true,
            meta: { changes: 1 },
          };
        },
      };

      return statement;
    },
  };

  return {
    db: db as unknown as D1Database,
  };
}

function createTestApp(db: D1Database) {
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();

  // Test-only context injection; production authentication
  // remains configured in src/bootstrap/routes.ts.
  app.use("*", async (c, next) => {
    const tenantId =
      c.req.header("x-test-tenant") ?? "tenant-a";

    const context = {
        client: {
            id: "test-client",
            tenantId,
            permissions: ["features:read", "features:write"],
        },
        tenant: {
            id: tenantId,
            name: tenantId,
        },
        } as unknown as RequestContext;

    c.set("context", context);
    c.set("principal", {
        type: "client",
        clientId: "test-client",
        tenantId,
        permissions: ["features:read", "features:write"],
    } satisfies AuthenticatedPrincipal);
    await next();
  });

  app.route("/features", featureRoutes);

  return {
    request(
      path: string,
      init: RequestInit = {},
      tenantId = "tenant-a",
    ) {
      const headers = new Headers(init.headers);
      headers.set("x-test-tenant", tenantId);

      return app.request(
        path,
        { ...init, headers },
        { DB: db } as AppBindings,
      );
    },
  };
}

test("GET /features returns default states", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  const response = await app.request("/features");

  assert.equal(response.status, 200);

  const body = await response.json() as {
    success: boolean;
    features: Array<{
      key: string;
      enabled: boolean;
    }>;
  };

  assert.equal(body.success, true);
  assert.equal(
    body.features.find((f) => f.key === "ai_chat")?.enabled,
    true,
  );
  assert.equal(
    body.features.find((f) => f.key === "ai_booking")?.enabled,
    true,
  );
  assert.equal(
    body.features.find(
      (f) => f.key === "booking_appointment",
    )?.enabled,
    true,
  );

  assert.equal(
    body.features.find(
      (f) => f.key === "booking_accommodation",
    )?.enabled,
    false,
  );
});

test("PATCH /features/ai_chat changes only AI Chat", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  const response = await app.request(
    "/features/ai_chat",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
  );

  assert.equal(response.status, 200);

  const listResponse = await app.request("/features");
  const body = await listResponse.json() as {
    features: Array<{ key: string; enabled: boolean }>;
  };

  assert.equal(
    body.features.find((f) => f.key === "ai_chat")?.enabled,
    false,
  );
  assert.equal(
    body.features.find((f) => f.key === "ai_booking")?.enabled,
    true,
  );
});

test("PATCH /features/ai_booking changes only AI Booking", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  const response = await app.request(
    "/features/ai_booking",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
  );

  assert.equal(response.status, 200);

  const listResponse = await app.request("/features");
  const body = await listResponse.json() as {
    features: Array<{ key: string; enabled: boolean }>;
  };

  assert.equal(
    body.features.find((f) => f.key === "ai_chat")?.enabled,
    true,
  );
  assert.equal(
    body.features.find((f) => f.key === "ai_booking")?.enabled,
    false,
  );
});

test("feature settings remain isolated between tenants", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  await app.request(
    "/features/ai_chat",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
    "tenant-a",
  );

  const tenantAResponse = await app.request(
    "/features",
    {},
    "tenant-a",
  );
  const tenantBResponse = await app.request(
    "/features",
    {},
    "tenant-b",
  );

  const tenantA = await tenantAResponse.json() as {
    features: Array<{ key: string; enabled: boolean }>;
  };
  const tenantB = await tenantBResponse.json() as {
    features: Array<{ key: string; enabled: boolean }>;
  };

  assert.equal(
    tenantA.features.find((f) => f.key === "ai_chat")?.enabled,
    false,
  );
  assert.equal(
    tenantB.features.find((f) => f.key === "ai_chat")?.enabled,
    true,
  );
});

test("unknown feature keys are rejected", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  const response = await app.request(
    "/features/not_registered",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    },
  );

  assert.equal(response.status, 404);
});

test("non-boolean enabled values are rejected", async () => {
  const { db } = createFakeDb();
  const app = createTestApp(db);

  const response = await app.request(
    "/features/ai_chat",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "false" }),
    },
  );

  assert.equal(response.status, 400);
});

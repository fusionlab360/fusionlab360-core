import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../../src/config/app";

import type { RequestContext } from "../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";

import integrationRoutes from "../../../src/domain/integration/routes";

function createFakeDb(
  initialSettings: Record<string, unknown> = {},
) {
  const settings = new Map<string, string>(
    Object.entries(initialSettings).map(
      ([integrationId, configuration]) => [
        integrationId,
        JSON.stringify(configuration),
      ],
    ),
  );

  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];

      const statement = {
        bind(...args: unknown[]) {
          values = args;
          return statement;
        },

        async first<T>() {
          if (/SELECT\s+settings/i.test(sql)) {
            const integrationId = values[0];

            if (typeof integrationId !== "string") {
              throw new Error("Expected integration ID.");
            }

            const stored = settings.get(integrationId);

            return (
              stored === undefined
                ? null
                : { settings: stored }
            ) as T | null;
          }

          throw new Error("Unexpected SQL first() query.");
        },

        async run() {
          if (/UPDATE\s+integrations/i.test(sql)) {
            const [serializedSettings, integrationId] = values;

            if (
              typeof serializedSettings !== "string" ||
              typeof integrationId !== "string"
            ) {
              throw new Error("Invalid integration settings update.");
            }

            if (!settings.has(integrationId)) {
              return {
                success: true,
                meta: { changes: 0 },
              };
            }

            settings.set(integrationId, serializedSettings);

            return {
              success: true,
              meta: { changes: 1 },
            };
          }

          throw new Error("Unexpected SQL run() query.");
        },
      };

      return statement;
    },
  };

  return {
    db: db as unknown as D1Database,

    readSettings(integrationId: string) {
      const stored = settings.get(integrationId);
      return stored ? JSON.parse(stored) as Record<string, unknown> : null;
    },
  };
}

function createTestApp(
  db: D1Database,
  providers: Record<string, string> = {},
) {
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();

  app.use("*", async (c, next) => {
    const tenantId =
      c.req.header("x-test-tenant") ?? "tenant-a";

    const provider =
      providers[tenantId] ?? "gohighlevel";

    const permissions = [
      "integrations:read",
      "integrations:write",
    ];

    const context = {
      client: {
        id: `client-${tenantId}`,
        tenantId,
        permissions,
      },

      tenant: {
        id: tenantId,
        name: tenantId,
        status: "active",

        integrations: {
          crm: {
            id: `${tenantId}-crm`,
            provider,
            credentials: {
              apiKey: "test-only",
              locationId: "test-location",
            },
            configuration: null,
          },

          pms: {
            provider: "cloudbeds",
          },
        },
      },

      requestId: `request-${tenantId}`,
      receivedAt: new Date(),
      integrationRuntime: {},
    } as unknown as RequestContext;

    c.set("context", context);

    c.set("principal", {
      type: "client",
      clientId: `client-${tenantId}`,
      tenantId,
      permissions,
    } satisfies AuthenticatedPrincipal);

    await next();
  });

  app.route("/integrations", integrationRoutes);

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

const endpoint =
  "/integrations/gohighlevel/rentals/booking-page";

test(
  "GET Rentals booking page returns the authenticated tenant's saved URL",
  async () => {
    const { db } = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [{ source: "email", target: "email" }],
        providerConfiguration: {
          rentalsBookingUrl:
            "https://rentals.example.com/property-a",
        },
      },
    });

    const app = createTestApp(db);

    const response = await app.request(endpoint);

    assert.equal(response.status, 200);

    const body = await response.json() as {
      success: boolean;
      bookingUrl: string | null;
    };

    assert.equal(body.success, true);
    assert.equal(
      body.bookingUrl,
      "https://rentals.example.com/property-a",
    );
  },
);

test(
  "PATCH stores the Rentals URL and preserves existing integration settings",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [{ source: "email", target: "email" }],
        providerConfiguration: {
          existingOption: "keep-me",
        },
      },
    });

    const app = createTestApp(fake.db);

    const response = await app.request(
      endpoint,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingUrl:
            "https://rentals.example.com/property-a",
        }),
      },
    );

    assert.equal(response.status, 200);

    const body = await response.json() as {
      success: boolean;
      bookingUrl: string | null;
    };

    assert.equal(body.success, true);
    assert.equal(
      body.bookingUrl,
      "https://rentals.example.com/property-a",
    );

    const stored = fake.readSettings("tenant-a-crm");

    assert.ok(stored);
    assert.deepEqual(stored.workflow, { id: "workflow-a" });
    assert.deepEqual(
      stored.attributeMappings,
      [{ source: "email", target: "email" }],
    );
    assert.deepEqual(
      stored.providerConfiguration,
      {
        existingOption: "keep-me",
        rentalsBookingUrl:
          "https://rentals.example.com/property-a",
      },
    );
  },
);

test(
  "PATCH rejects non-HTTPS URLs",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        providerConfiguration: {
          existingOption: "keep-me",
        },
      },
    });

    const app = createTestApp(fake.db);

    const response = await app.request(
      endpoint,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingUrl: "http://example.com/rentals",
        }),
      },
    );

    assert.equal(response.status, 400);

    const stored = fake.readSettings("tenant-a-crm");

    assert.deepEqual(
      stored?.providerConfiguration,
      { existingOption: "keep-me" },
    );
  },
);

test(
  "Rentals booking-page configuration remains tenant-scoped",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        providerConfiguration: {},
      },

      "tenant-b-crm": {
        providerConfiguration: {
          rentalsBookingUrl:
            "https://rentals.example.com/property-b",
        },
      },
    });

    const app = createTestApp(fake.db);

    const patchResponse = await app.request(
      endpoint,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingUrl:
            "https://rentals.example.com/property-a",
        }),
      },
      "tenant-a",
    );

    assert.equal(patchResponse.status, 200);

    const tenantBResponse = await app.request(
      endpoint,
      {},
      "tenant-b",
    );

    assert.equal(tenantBResponse.status, 200);

    const body = await tenantBResponse.json() as {
      success: boolean;
      bookingUrl: string | null;
    };

    assert.equal(
      body.bookingUrl,
      "https://rentals.example.com/property-b",
    );

    assert.equal(
      fake.readSettings("tenant-a-crm")
        ?.providerConfiguration !== undefined,
      true,
    );
  },
);

test(
  "Rentals configuration is unavailable for a non-GHL CRM integration",
  async () => {
    const { db } = createFakeDb({
      "tenant-a-crm": {
        providerConfiguration: {},
      },
    });

    const app = createTestApp(db, {
      "tenant-a": "hubspot",
    });

    const response = await app.request(endpoint);

    assert.equal(response.status, 409);
  },
);
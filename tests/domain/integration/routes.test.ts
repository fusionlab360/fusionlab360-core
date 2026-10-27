import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../../src/config/app";

import type { RequestContext } from "../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";
import type { Tenant } from "../../../src/tenants/types";
import type { IntegrationConfiguration } from "../../../src/persistence/models/integration-configuration";

import integrationRoutes from "../../../src/domain/integration/routes";
import { resolveGHLConversationProviderId } from "../../../src/integrations/messaging/gohighlevel/custom-conversation-provider";

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

    readSettings<T = Record<string, unknown>>(integrationId: string): T | null {
      const stored = settings.get(integrationId);
      return stored ? JSON.parse(stored) as T : null;
    },
  };
}

function createTestApp(
  db: D1Database,
  providers: Record<string, string> = {},
  options: { permissions?: string[] } = {},
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

    const permissions = options.permissions ?? [
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

const customProviderEndpoint =
  "/integrations/gohighlevel/custom-conversation-provider";

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

    const stored = fake.readSettings<IntegrationConfiguration>("tenant-a-crm");

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

test(
  "PATCH stores an authenticated tenant's Custom Conversation Provider ID and preserves settings",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [{ source: "email", target: "email" }],
        providerConfiguration: {
          existingOption: "keep-me",
          rentalsBookingUrl: "https://rentals.example.test/a",
        },
      },
    });
    const app = createTestApp(fake.db);

    const response = await app.request(customProviderEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationProviderId: "provider_12345678" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      conversationProviderId: "provider_12345678",
    });

    const stored = fake.readSettings<IntegrationConfiguration>("tenant-a-crm");
    assert.deepEqual(stored?.workflow, { id: "workflow-a" });
    assert.deepEqual(stored?.attributeMappings, [{ source: "email", target: "email" }]);
    assert.deepEqual(stored?.providerConfiguration, {
      existingOption: "keep-me",
      rentalsBookingUrl: "https://rentals.example.test/a",
      conversationProviderId: "provider_12345678",
    });

    const publisherTenant = {
      id: "tenant-a",
      name: "Synthetic tenant",
      status: "active",
      integrations: {
        crm: {
          id: "tenant-a-crm",
          provider: "gohighlevel",
          credentials: { locationId: "test-location" },
          configuration: stored,
        },
        pms: { provider: "cloudbeds" },
      },
    } as Tenant;
    assert.equal(
      resolveGHLConversationProviderId(publisherTenant),
      "provider_12345678",
    );
  },
);

test(
  "Custom Conversation Provider configuration is tenant scoped",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [],
        providerConfiguration: {},
      },
      "tenant-b-crm": {
        workflow: { id: "workflow-b" },
        attributeMappings: [],
        providerConfiguration: {
          conversationProviderId: "provider_b_12345678",
        },
      },
    });
    const app = createTestApp(fake.db);

    const update = await app.request(
      customProviderEndpoint,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationProviderId: "provider_a_12345678" }),
      },
      "tenant-a",
    );
    assert.equal(update.status, 200);

    const tenantB = await app.request(customProviderEndpoint, {}, "tenant-b");
    assert.equal(tenantB.status, 200);
    assert.deepEqual(await tenantB.json(), {
      success: true,
      conversationProviderId: "provider_b_12345678",
    });
    assert.equal(
      fake.readSettings<{ providerConfiguration?: Record<string, unknown> }>("tenant-b-crm")
        ?.providerConfiguration?.["conversationProviderId"],
      "provider_b_12345678",
    );
  },
);

test(
  "Custom Conversation Provider update requires integrations:write",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [],
        providerConfiguration: {},
      },
    });
    const app = createTestApp(fake.db, {}, {
      permissions: ["integrations:read"],
    });

    const response = await app.request(customProviderEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationProviderId: "provider_12345678" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(fake.readSettings("tenant-a-crm")?.providerConfiguration, {});
  },
);

test(
  "Custom Conversation Provider update rejects malformed IDs, arbitrary settings, and non-GHL integrations",
  async () => {
    const fake = createFakeDb({
      "tenant-a-crm": {
        workflow: { id: "workflow-a" },
        attributeMappings: [],
        providerConfiguration: {},
      },
    });
    const app = createTestApp(fake.db);

    const malformed = await app.request(customProviderEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationProviderId: "bad value!" }),
    });
    assert.equal(malformed.status, 400);

    const arbitrarySettings = await app.request(customProviderEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationProviderId: "provider_12345678",
        tenantId: "tenant-b",
      }),
    });
    assert.equal(arbitrarySettings.status, 400);

    const nonGHLApp = createTestApp(fake.db, { "tenant-a": "hubspot" });
    const nonGHL = await nonGHLApp.request(customProviderEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationProviderId: "provider_12345678" }),
    });
    assert.equal(nonGHL.status, 409);
  },
);

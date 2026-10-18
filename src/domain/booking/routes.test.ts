import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import bookingRoutes from "./routes";

import type { RequestContext } from "../../context/types";
import type { AuthenticatedPrincipal } from "../../core/security/principal";

const app = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

const testTenantId = "booking-test-tenant";

function createFeatureSettingsDb(
  settings: Record<string, boolean>,
): D1Database {
  return {
    prepare: () => ({
      bind: (tenantId: string, featureKey: string) => ({
        first: async () => {
          const key = `${tenantId}:${featureKey}`;

          if (!Object.prototype.hasOwnProperty.call(settings, key)) {
            return null;
          }

          return {
            enabled: settings[key] ? 1 : 0,
          };
        },
      }),
    }),
  } as unknown as D1Database;
}

const disabledBookingCases = [
  {
    name: "disabled appointment setting blocks offerings",
    path: "/booking/offerings?type=appointment",
    method: "GET" as const,
    featureKey: "booking_appointment",
    body: undefined,
  },
  {
    name: "disabled accommodation setting blocks availability",
    path: "/booking/availability",
    method: "POST" as const,
    featureKey: "booking_accommodation",
    body: {
      type: "accommodation",
      offeringId: "room-test",
      start: "2026-10-20",
      end: "2026-10-21",
    },
  },
  {
    name: "disabled appointment setting blocks creation",
    path: "/booking",
    method: "POST" as const,
    featureKey: "booking_appointment",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      customerId: "contact-test",
      start: "2026-10-20T10:00:00Z",
      end: "2026-10-20T10:30:00Z",
    },
  },
] as const;

for (const testCase of disabledBookingCases) {
  test(testCase.name, async () => {
    const db = createFeatureSettingsDb({
      [`${testTenantId}:${testCase.featureKey}`]: false,
    });

    const response = await app.request(
      testCase.path,
      {
        method: testCase.method,
        headers: testCase.body
          ? { "Content-Type": "application/json" }
          : undefined,
        body: testCase.body
          ? JSON.stringify(testCase.body)
          : undefined,
      },
      {
        APP_ENVIRONMENT: "development",
        DB: db,
      } as AppBindings,
    );

    assert.equal(response.status, 403);
  });
}

const testPermissions = [
  "booking:read",
  "booking:create",
  "booking:test",
] as const;

app.use("*", async (c, next) => {
  const context = {
    client: {
      id: "booking-test-client",
      tenantId: testTenantId,
      permissions: testPermissions,
    },
    tenant: {
      id: testTenantId,
      name: testTenantId,
    },
    requestId: "booking-route-test",
    receivedAt: new Date(),
    integrationRuntime: {},
  } as unknown as RequestContext;

  c.set("context", context);

  c.set("principal", {
    type: "client",
    clientId: "booking-test-client",
    tenantId: testTenantId,
    permissions: testPermissions,
  } satisfies AuthenticatedPrincipal);

  await next();
});

app.route("/booking", bookingRoutes);

const testRoutes = [
  {
    path: "/booking/intent-test",
    body: { message: "Test booking intent" },
  },
  {
    path: "/booking/ai-test",
    body: {
      conversationId: "test-conversation",
      customerId: "test-customer",
      message: "Test booking workflow",
    },
  },
] as const;

for (const route of testRoutes) {
  test(`${route.path} is hidden when environment is missing`, async () => {
    const response = await app.request(
      route.path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(route.body),
      },
      {} as AppBindings,
    );

    assert.equal(response.status, 404);
  });

  test(`${route.path} is hidden in production`, async () => {
    const response = await app.request(
      route.path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(route.body),
      },
      { APP_ENVIRONMENT: "production" } as AppBindings,
    );

    assert.equal(response.status, 404);
  });
}

const invalidBookingDateCases = [
  {
    name: "availability rejects malformed start",
    path: "/booking/availability",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      start: "not-a-date",
      end: "2026-10-20T10:00:00Z",
    },
  },
  {
    name: "availability rejects impossible calendar dates",
    path: "/booking/availability",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      start: "2026-02-30T09:00:00Z",
      end: "2026-03-01T10:00:00Z",
    },
  },
  {
    name: "availability rejects reversed time ranges",
    path: "/booking/availability",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      start: "2026-10-20T11:00:00Z",
      end: "2026-10-20T10:00:00Z",
    },
  },
  {
    name: "appointment creation rejects date-only values",
    path: "/booking",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      customerId: "contact-test",
      start: "2026-10-20",
      end: "2026-10-21",
    },
  },
  {
    name: "booking creation rejects reversed time ranges",
    path: "/booking",
    body: {
      type: "appointment",
      offeringId: "calendar-test",
      customerId: "contact-test",
      start: "2026-10-20T11:00:00Z",
      end: "2026-10-20T10:00:00Z",
    },
  },
] as const;

for (const testCase of invalidBookingDateCases) {
  test(testCase.name, async () => {
    const response = await app.request(
      testCase.path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testCase.body),
      },
      {
        APP_ENVIRONMENT: "development",
      } as AppBindings,
    );

    assert.equal(response.status, 400);
  });
}
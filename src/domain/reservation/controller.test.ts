import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type { AppBindings, AppVariables } from "../../config/app";
import type { RequestContext } from "../../context/types";
import type { AuthenticatedPrincipal } from "../../core/security/principal";
import { handleError } from "../../bootstrap/error";
import { requirePermission } from "../../middleware/authorization";
import { authMiddleware } from "../../middleware/auth";
import { hashApiKey } from "../../core/security/api-key";
import { createProcessReservationController } from "./controller";
import type { ReservationPayload } from "./types";
import type { ReservationResult } from "./result";

const successResult: ReservationResult = {
  success: true,
  message: "Reservation synced successfully.",
  contactId: "contact-test",
  opportunityId: "opportunity-test",
};

function createTestApp(options: {
  permissions?: string[];
  principalTenantId?: string;
  processor?: (
    db: D1Database,
    context: RequestContext,
    payload: ReservationPayload,
  ) => Promise<ReservationResult>;
} = {}) {
  let processed: { context: RequestContext; payload: ReservationPayload } | undefined;
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.onError(handleError);
  app.use("*", async (c, next) => {
    const context = {
      client: {
        id: "client-a",
        tenantId: "tenant-a",
        permissions: options.permissions ?? ["reservations:sync"],
      },
      tenant: { id: "tenant-a", name: "Tenant A" },
    } as unknown as RequestContext;
    c.set("context", context);
    c.set("principal", {
      type: "client",
      clientId: "client-a",
      tenantId: options.principalTenantId ?? "tenant-a",
      permissions: options.permissions ?? ["reservations:sync"],
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  const processor = options.processor ?? (async (_db, context, payload) => {
    processed = { context, payload };
    return successResult;
  });
  app.post(
    "/reservations/sync",
    requirePermission("reservations:sync"),
    createProcessReservationController(processor),
  );
  const bindings = { DB: {} as D1Database } as AppBindings;
  return {
    request: (path: string, init: RequestInit) => app.request(path, init, bindings),
    getProcessed: () => processed,
  };
}

async function createAuthenticatedTestApp(apiKey: string) {
  const expectedHash = await hashApiKey(apiKey);
  const clientRecord = {
    id: "client-a",
    tenant_id: "tenant-a",
    name: "Synthetic Extension Client",
    api_key_hash: expectedHash,
    status: "active",
    permissions: JSON.stringify(["reservations:sync"]),
  };
  const integrationRecord = {
    id: "integration-a",
    tenant_id: "tenant-a",
    provider: "gohighlevel",
    enabled: 1,
    settings: null,
  };
  const tenantRecord = {
    id: "tenant-a",
    name: "Tenant A",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound;
          return this;
        },
        async first<T>() {
          if (sql.includes("FROM clients") && sql.includes("api_key_hash")) {
            return (values[0] === expectedHash ? clientRecord : null) as T | null;
          }
          if (sql.includes("FROM tenants")) return tenantRecord as T;
          if (sql.includes("SELECT settings")) return null;
          return null;
        },
        async all<T>() {
          if (sql.includes("FROM integrations")) {
            return { results: [integrationRecord] as T[] };
          }
          return { results: [] as T[] };
        },
      };
    },
  } as unknown as D1Database;

  let processed: { context: RequestContext; payload: ReservationPayload } | undefined;
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.onError(handleError);
  app.use("/reservations/*", authMiddleware);
  app.post(
    "/reservations/sync",
    requirePermission("reservations:sync"),
    createProcessReservationController(async (_db, context, payload) => {
      processed = { context, payload };
      return successResult;
    }),
  );

  const bindings = {
    DB: db,
    GHL_OAUTH_CLIENT_ID: "",
    GHL_OAUTH_CLIENT_SECRET: "",
    GHL_OAUTH_REDIRECT_URI: "",
  } as AppBindings;
  return {
    request: (credential: string, body: unknown, headers: HeadersInit = {}) =>
      app.request("/reservations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}`, ...headers },
        body: JSON.stringify(body),
      }, bindings),
    getProcessed: () => processed,
  };
}

const validPayload = {
  reservationId: "reservation-123",
  firstName: "Amina",
  lastName: "Guest",
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  adults: 2,
  passport: "SENSITIVE-TEST-VALUE",
};

test("authorized reservation sync validates and passes the extension payload to the processor", async () => {
  const { request, getProcessed } = createTestApp();
  const response = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validPayload, tenantId: "tenant-b", clientId: "client-b" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), successResult);
  const processed = getProcessed();
  assert.ok(processed);
  assert.equal(processed.context.tenant.id, "tenant-a");
  assert.equal(processed.payload.reservationId, "reservation-123");
  assert.equal(processed.payload.adults, 2);
  assert.equal("tenantId" in processed.payload, false);
  assert.equal("clientId" in processed.payload, false);
});

test("API key authentication, tenant resolution, scope authorization, and reservation processing connect end to end", async () => {
  const apiKey = "fl360_synthetic-reservation-key";
  const { request, getProcessed } = await createAuthenticatedTestApp(apiKey);
  let diagnosticOutput = "";
  const originalConsoleLog = console.log;
  console.log = (...values: unknown[]) => {
    diagnosticOutput += values.map(String).join(" ");
  };
  let response: Response;
  try {
    response = await request(apiKey, {
      ...validPayload,
      tenantId: "tenant-b",
      clientId: "client-b",
    }, {
      "x-tenant-id": "tenant-b",
      "x-client-id": "client-b",
    });
  } finally {
    console.log = originalConsoleLog;
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), successResult);
  assert.equal(getProcessed()?.context.tenant.id, "tenant-a");
  assert.equal(getProcessed()?.payload.reservationId, "reservation-123");
  assert.doesNotMatch(diagnosticOutput, /SENSITIVE-TEST-VALUE/);
});

test("invalid API key is rejected before reservation processing", async () => {
  const { request, getProcessed } = await createAuthenticatedTestApp("fl360_valid-key");
  const response = await request("fl360_wrong-key", validPayload);
  assert.equal(response.status, 401);
  assert.equal(getProcessed(), undefined);
});

test("missing reservation permission is denied before processing", async () => {
  const { request, getProcessed } = createTestApp({ permissions: ["reservations:read"] });
  const response = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  assert.equal(response.status, 403);
  assert.equal(getProcessed(), undefined);
});

test("mismatched authenticated tenant is denied", async () => {
  const { request, getProcessed } = createTestApp({ principalTenantId: "tenant-b" });
  const response = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validPayload, tenantId: "tenant-b" }),
  });
  assert.equal(response.status, 401);
  assert.equal(getProcessed(), undefined);
});

test("malformed JSON and invalid reservation fields return predictable 400 responses", async () => {
  const { request, getProcessed } = createTestApp();
  const malformedJson = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json() as { message: string }).message, "Request body must contain valid JSON.");

  const invalidField = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validPayload, adults: "two" }),
  });
  assert.equal(invalidField.status, 400);
  assert.equal((await invalidField.json() as { message: string }).message, "Invalid reservation payload.");
  assert.equal(getProcessed(), undefined);
});

test("processing failures do not return false success or leak provider details", async () => {
  const { request } = createTestApp({
    processor: async () => {
      throw new Error("provider response included a passport number");
    },
  });
  const response = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  assert.equal(response.status, 500);
  const responseBody = await response.text();
  assert.match(responseBody, /Internal Server Error/);
  assert.doesNotMatch(responseBody, /passport|provider response/i);
});

test("processor result with success false is returned as a gateway failure", async () => {
  const { request } = createTestApp({
    processor: async () => ({ ...successResult, success: false }),
  });
  const response = await request("/reservations/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json() as { message: string }).message, "Reservation processing did not complete.");
});


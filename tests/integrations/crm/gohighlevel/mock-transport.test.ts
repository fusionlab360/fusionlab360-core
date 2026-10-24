import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../../../../src/core/errors/ApiError";

import type { RequestContext } from "../../../../src/context";
import type { IntegrationRuntime } from "../../../../src/core/integration/runtime";
import type { Tenant } from "../../../../src/tenants/types";
import { ReservationFields } from "../../../../src/canonical/reservation";
import { goHighLevelAdapter } from "../../../../src/integrations/crm/gohighlevel/adapter";
import { createGHLMockEnvironment } from "../../../../src/integrations/crm/gohighlevel/testing/mock-transport";

const tenantId = "synthetic-tenant-a";
const locationId = "synthetic-location-a";
const reservationFieldId = "synthetic-reservation-field";

function makeContext(
  id: string,
  location: string,
  runtime: IntegrationRuntime,
): RequestContext {
  const tenant: Tenant = {
    id,
    name: `Synthetic ${id}`,
    status: "active",
    integrations: {
      crm: {
        id: `crm-${id}`,
        provider: "gohighlevel",
        credentials: { locationId: location },
        configuration: {
          workflow: {
            key: "reservation-workflow",
            providerWorkflowId: "synthetic-pipeline",
            states: [
              { key: "new_booking", providerStateId: "synthetic-open-stage" },
              { key: "cancelled", providerStateId: "synthetic-cancelled-stage" },
            ],
          },
          attributeMappings: [
            { canonicalKey: ReservationFields.ReservationId, providerFieldId: reservationFieldId },
          ],
        },
      },
      pms: { provider: "browser" },
    },
  };
  return {
    client: {
      id: `client-${id}`,
      name: `Synthetic client ${id}`,
      tenantId: id,
      apiKey: "synthetic-api-key",
      status: "active",
      permissions: [],
    },
    tenant,
    requestId: `synthetic-request-${id}`,
    receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    integrationRuntime: runtime,
  };
}

function reservationPayload(contactId: string) {
  return {
    contactId,
    guestName: "Example Guest",
    reservationId: "synthetic-reservation-001",
    status: "CONFIRMED",
  };
}

function requireId(id: string | undefined): string {
  if (!id) throw new Error("Expected a synthetic provider ID.");
  return id;
}

test("mock GHL contact create, lookup, update and duplicate upsert use the real adapter", async () => {
  const mock = createGHLMockEnvironment({ tenantId, locationId, reservationFieldId });
  const context = makeContext(tenantId, locationId, mock.runtime);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Global fetch must not be used in mock mode.");
  };
  try {
    const created = await goHighLevelAdapter.upsertContact(context, {
      firstName: "Example",
      lastName: "Guest",
      email: "guest@example.invalid",
      phone: "+60123456789",
    });
    assert.match(created.id ?? "", /^mock_contact_[a-f0-9]{24}$/);

    const createdId = requireId(created.id);
    const found = await goHighLevelAdapter.getContact(context, createdId);
    assert.equal(found.email, "guest@example.invalid");

    const updated = await goHighLevelAdapter.updateContact(context, requireId(found.id), {
      firstName: "Updated",
    });
    assert.equal(updated.firstName, "Updated");

    const duplicate = await goHighLevelAdapter.upsertContact(context, {
      firstName: "Updated",
      lastName: "Guest",
      email: "guest@example.invalid",
      phone: "+60123456789",
    });
    assert.equal(duplicate.id, createdId);
    assert.deepEqual(mock.snapshot(), { contactCount: 1, opportunityCount: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock GHL opportunity create, search, update and duplicate delivery are deterministic", async () => {
  const mock = createGHLMockEnvironment({ tenantId, locationId, reservationFieldId });
  const context = makeContext(tenantId, locationId, mock.runtime);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Global fetch must not be used in mock mode.");
  };
  try {
    const contact = await goHighLevelAdapter.upsertContact(context, {
      firstName: "Example",
      email: "reservation@example.invalid",
    });
    const payload = reservationPayload(requireId(contact.id));
    const created = await goHighLevelAdapter.createOpportunity(context, payload);
    assert.match(created.id, /^mock_opportunity_[a-f0-9]{24}$/);

    const found = await goHighLevelAdapter.searchOpportunity(
      context,
      requireId(contact.id),
      payload.reservationId,
    );
    assert.deepEqual(found, { id: created.id, pipelineStageId: "synthetic-open-stage" });

    await goHighLevelAdapter.moveOpportunity(context, created.id, "synthetic-updated-stage");
    const duplicate = await goHighLevelAdapter.upsertOpportunity(context, payload);
    assert.equal(duplicate.id, created.id);
    assert.deepEqual(mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock credentials never use the live resolver and fail closed when transport is incomplete", async () => {
  const mock = createGHLMockEnvironment({ tenantId, locationId, reservationFieldId });
  const context = makeContext(tenantId, locationId, mock.runtime);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Global fetch must not be used in mock mode.");
  };
  try {
    await assert.rejects(
      goHighLevelAdapter.getContact(context, "missing-contact"),
      /Synthetic contact not found/,
    );

    let liveCredentialCalls = 0;
    const incompleteContext = makeContext(tenantId, locationId, {
      transportMode: "mock",
      credentials: {
        async resolve() {
          liveCredentialCalls += 1;
          throw new Error("Live credential resolver should not run.");
        },
      },
    });
    await assert.rejects(
      goHighLevelAdapter.getContact(incompleteContext, "missing-contact"),
      /mock transport configuration is invalid/,
    );
    assert.equal(liveCredentialCalls, 0);

    let unselectedCredentialCalls = 0;
    const unselectedTransportContext = makeContext(tenantId, locationId, {
      credentials: {
        async resolve() {
          unselectedCredentialCalls += 1;
          throw new Error("Unselected transport credentials should not run.");
        },
      },
      httpTransport: {
        fetch: mock.fetch,
        credentials: {
          async resolve() {
            throw new Error("Unselected transport should not run.");
          },
        },
      },
    });
    await assert.rejects(
      goHighLevelAdapter.getContact(unselectedTransportContext, "missing-contact"),
      /requires explicit mock mode/,
    );
    assert.equal(unselectedCredentialCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mock GHL simulates transient, permanent and malformed responses through client handling", async () => {
  const mock = createGHLMockEnvironment({ tenantId, locationId, reservationFieldId });
  const context = makeContext(tenantId, locationId, mock.runtime);
  const payload = { firstName: "Example", email: "failure@example.invalid" };

  mock.failNext("contact_upsert", "transient");
  await assert.rejects(goHighLevelAdapter.upsertContact(context, payload), (error: unknown) =>
    error instanceof ApiError && error.status === 503,
  );

  mock.failNext("contact_upsert", "permanent");
  await assert.rejects(goHighLevelAdapter.upsertContact(context, payload), (error: unknown) =>
    error instanceof ApiError && error.status === 400,
  );

  mock.failNext("contact_upsert", "invalid_response");
  await assert.rejects(goHighLevelAdapter.upsertContact(context, payload));
  assert.deepEqual(mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
});

test("mock state and synthetic identifiers are isolated between tenants and locations", async () => {
  const mockA = createGHLMockEnvironment({ tenantId, locationId, reservationFieldId });
  const mockB = createGHLMockEnvironment({
    tenantId: "synthetic-tenant-b",
    locationId: "synthetic-location-b",
    reservationFieldId,
  });
  const contextA = makeContext(tenantId, locationId, mockA.runtime);
  const contextB = makeContext("synthetic-tenant-b", "synthetic-location-b", mockB.runtime);

  const contactA = await goHighLevelAdapter.upsertContact(contextA, {
    firstName: "Example",
    email: "same@example.invalid",
  });
  const contactB = await goHighLevelAdapter.upsertContact(contextB, {
    firstName: "Example",
    email: "same@example.invalid",
  });
  assert.notEqual(contactA.id, contactB.id);
  assert.deepEqual(mockA.snapshot(), { contactCount: 1, opportunityCount: 0 });
  assert.deepEqual(mockB.snapshot(), { contactCount: 1, opportunityCount: 0 });
    await assert.rejects(
      goHighLevelAdapter.getContact(contextB, requireId(contactA.id)),
    /Synthetic contact not found/,
  );
});

test("default GHL runtime retains normal credential resolution and fetch behavior", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const runtime: IntegrationRuntime = {
    credentials: {
      async resolve(request) {
        credentialCalls += 1;
        assert.equal(request.tenantId, tenantId);
        return { authType: "api_key", accessToken: "synthetic-default-token" };
      },
    },
  };
  const context = makeContext(tenantId, locationId, runtime);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ contact: { id: "default-contact", firstName: "Default" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await goHighLevelAdapter.getContact(context, "default-contact");
    assert.equal(result.id, "default-contact");
    assert.equal(credentialCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default GHL OAuth 401 refresh and one retry remain unchanged", async () => {
  const credentialRequests: Array<{ forceRefresh?: boolean }> = [];
  let fetchCalls = 0;
  const runtime: IntegrationRuntime = {
    credentials: {
      async resolve(request) {
        credentialRequests.push({ forceRefresh: request.forceRefresh });
        return {
          authType: "oauth2",
          accessToken: request.forceRefresh ? "synthetic-refreshed-token" : "synthetic-expired-token",
        };
      },
    },
  };
  const context = makeContext(tenantId, locationId, runtime);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    const authorization = new Headers(init?.headers).get("Authorization");
    if (authorization === "Bearer synthetic-expired-token") {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    assert.equal(authorization, "Bearer synthetic-refreshed-token");
    return new Response(JSON.stringify({ contact: { id: "oauth-contact", firstName: "OAuth" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await goHighLevelAdapter.getContact(context, "oauth-contact");
    assert.equal(result.id, "oauth-contact");
    assert.equal(fetchCalls, 2);
    assert.deepEqual(credentialRequests, [{ forceRefresh: undefined }, { forceRefresh: true }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

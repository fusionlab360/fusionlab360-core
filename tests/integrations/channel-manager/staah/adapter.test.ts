import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSTAAHAdapter,
  STAAHAdapterError,
  STAAH_PROVIDER_REGISTRATION,
  type STAAHConnectionContext,
} from "../../../../src/integrations/channel-manager/staah/index";

const context: STAAHConnectionContext = {
  tenantId: "tenant-a",
  integrationId: "integration-a",
  connectionId: "connection-a",
};

test("registers STAAH as a mock-only channel manager", () => {
  assert.deepEqual(STAAH_PROVIDER_REGISTRATION, {
    provider: "staah",
    displayName: "STAAH",
    category: "channel_manager",
    initialMode: "mock",
    liveSupported: false,
    downstreamSynchronization: false,
  });
});

test("defaults to the CRM profile in mock mode without credentials", async () => {
  const adapter = resolveSTAAHAdapter(context);
  const result = await adapter.verifyConnection(context);

  assert.equal(adapter.mode, "mock");
  assert.equal(adapter.profile, "crm");
  assert.equal(result.status, "mock_verified");
  assert.equal(result.provider, "staah");
  assert.equal(result.capabilities.liveConnectionVerification, false);
  assert.equal(result.capabilities.downstreamSynchronization, false);
  assert.equal(result.capabilities.propertyInformation, true);
  assert.equal(result.capabilities.roomRateMapping, true);
  assert.equal(result.capabilities.reservationRetrieval, true);
});

test("rejects empty tenant, integration, or connection context", () => {
  assert.throws(
    () => resolveSTAAHAdapter({ ...context, tenantId: " " }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "invalid_configuration",
  );
});

test("rejects malformed mock configuration", () => {
  assert.throws(
    () => resolveSTAAHAdapter(context, {
      simulateVerificationFailure: "yes",
    }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "invalid_configuration",
  );
});

test("rejects unsupported API profiles without falling back", () => {
  for (const profile of ["channelconnect_v2", "rms", "metachannel"]) {
    assert.throws(
      () => resolveSTAAHAdapter(context, { profile }),
      (error: unknown) =>
        error instanceof STAAHAdapterError &&
        error.code === "unsupported_api_profile",
    );
  }

  assert.throws(
    () => resolveSTAAHAdapter(context, { profile: "unknown" }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "invalid_configuration",
  );
});

test("live mode fails closed instead of selecting the mock adapter", () => {
  assert.throws(
    () => resolveSTAAHAdapter(context, { mode: "live" }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "live_mode_not_supported",
  );
});

test("simulates a deterministic verification failure", async () => {
  const adapter = resolveSTAAHAdapter(context, {
    simulateVerificationFailure: true,
  });
  const result = await adapter.verifyConnection(context);

  assert.equal(result.status, "mock_failed");
  assert.equal(result.reason, "simulated_provider_failure");
  assert.deepEqual(
    adapter.classifyError(new Error("synthetic")),
    { category: "unknown", retryable: false },
  );
});

test("classifies configuration and unsupported adapter errors safely", () => {
  const adapter = resolveSTAAHAdapter(context);

  assert.deepEqual(
    adapter.classifyError(
      new STAAHAdapterError("invalid_configuration", "synthetic"),
    ),
    { category: "configuration", retryable: false },
  );
  assert.deepEqual(
    adapter.classifyError(
      new STAAHAdapterError("unsupported_api_profile", "synthetic"),
    ),
    { category: "unsupported", retryable: false },
  );
});

test("binds the adapter to one tenant, integration, and connection", async () => {
  const adapter = resolveSTAAHAdapter(context);

  await assert.rejects(
    adapter.verifyConnection({ ...context, tenantId: "tenant-b" }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "connection_context_mismatch",
  );

  await assert.rejects(
    adapter.verifyConnection({ ...context, integrationId: "integration-b" }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "connection_context_mismatch",
  );

  await assert.rejects(
    adapter.verifyConnection({ ...context, connectionId: "connection-b" }),
    (error: unknown) =>
      error instanceof STAAHAdapterError &&
      error.code === "connection_context_mismatch",
  );
});

test("mock verification performs no outbound network request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network access is disabled in this test.");
  }) as typeof fetch;

  try {
    const adapter = resolveSTAAHAdapter(context);
    const result = await adapter.verifyConnection(context);
    assert.equal(result.status, "mock_verified");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns deterministic synthetic property, room, rate, and reservation data", async () => {
  const adapter = resolveSTAAHAdapter(context);
  const property = await adapter.getProperty(context, "mock-property-alpha");
  const batch = await adapter.getReservations(context, property.providerPropertyId);

  assert.equal(property.providerPropertyId, "mock-property-alpha");
  assert.equal(property.rooms.length, 2);
  assert.equal(property.ratePlans.length, 2);
  assert.equal(batch.reservations.some((item) => item.status === "CANCELLED"), true);
  assert.equal(batch.reservations.some((item) => item.providerReservationId === "mock-res-001"), true);
  assert.equal(batch.reservations.some((item) => item.revision < 3), true);
});

test("property and reservation retrieval remain bound to the authorized connection", async () => {
  const adapter = resolveSTAAHAdapter(context);
  await assert.rejects(adapter.getProperty({ ...context, tenantId: "tenant-b" }, "mock-property-alpha"));
  await assert.rejects(adapter.getReservations({ ...context, integrationId: "integration-b" }, "mock-property-alpha"));
  await assert.rejects(adapter.getProperty(context, "real-property-1"));
});

test("provider and timeout failures are explicit mock-only outcomes", async () => {
  for (const [scenario, expectedCode] of [
    ["provider_unavailable", "mock_provider_unavailable"],
    ["timeout", "mock_timeout"],
  ] as const) {
    const adapter = resolveSTAAHAdapter(context, { mockFailureScenario: scenario });
    await assert.rejects(
      adapter.getReservations(context, "mock-property-alpha"),
      (error: unknown) => error instanceof STAAHAdapterError && error.code === expectedCode,
    );
  }

  const partial = resolveSTAAHAdapter(context, { mockFailureScenario: "partial_batch_failure" });
  const batch = await partial.getReservations(context, "mock-property-alpha");
  assert.equal(batch.failAfterReservations, 2);
});

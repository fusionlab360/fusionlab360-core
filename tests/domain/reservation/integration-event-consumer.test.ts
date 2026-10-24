import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

import type { RequestContext } from "../../../src/context";
import { ReservationFields } from "../../../src/canonical/reservation";
import { IntegrationEventProcessingError } from "../../../src/core/events/errors";
import { IntegrationEventService } from "../../../src/core/events/service";
import { IntegrationEventRepository } from "../../../src/persistence/repositories/integration-event-repository";
import { ReservationRecordRepository } from "../../../src/persistence/repositories/reservation-record-repository";
import { goHighLevelAdapter } from "../../../src/integrations/crm/gohighlevel/adapter";
import {
  createGHLMockEnvironment,
  type GHLMockEnvironment,
} from "../../../src/integrations/crm/gohighlevel/testing/mock-transport";
import {
  processReservationIntegrationEvent,
  ReservationIntegrationEventConsumer,
} from "../../../src/domain/reservation/integration-event-consumer";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const filename of readdirSync(join(process.cwd(), "migrations"))
      .filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => {
        values = bindings;
        return statement;
      },
      run: async () => {
        const result = this.sqlite.prepare(sql).run(...values as never[]);
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => this.sqlite.prepare(sql).get(...values as never[]) as T | undefined ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) results.push(await statement.run<T>());
    return results;
  }
}

const TENANT = "synthetic-tenant-a";
const SOURCE = "synthetic-staah-source";
const DESTINATION = "synthetic-ghl-destination";
const LOCATION = "synthetic-ghl-location";
const RESERVATION_FIELD = "synthetic-reservation-field";
const CANONICAL_ID = "canonical-reservation-001";

interface Fixture {
  db: SQLiteD1;
  events: IntegrationEventRepository;
  service: IntegrationEventService;
  consumer: ReservationIntegrationEventConsumer;
  mock: GHLMockEnvironment;
  eventId: string;
}

function destinationSettings(enabled = true): string {
  return JSON.stringify({
    reservationEventDelivery: {
      enabled,
      mode: "mock",
      sourceIntegrationIds: [SOURCE],
      locationId: LOCATION,
    },
  });
}

function makeContext(
  mock: GHLMockEnvironment,
  tenantId = TENANT,
  locationId = LOCATION,
  invalidMapping = false,
): RequestContext {
  return {
    client: {
      id: "synthetic-consumer",
      tenantId,
      name: "Synthetic consumer",
      apiKey: "synthetic-only",
      status: "active",
      permissions: [],
    },
    tenant: {
      id: tenantId,
      name: "Synthetic Tenant",
      status: "active",
      integrations: {
        crm: {
          id: DESTINATION,
          provider: "gohighlevel",
          credentials: { locationId },
          configuration: {
            workflow: {
              key: "reservation-delivery",
              providerWorkflowId: "synthetic-pipeline",
              states: [
                { key: "new_booking", providerStateId: "synthetic-open" },
                { key: "cancelled", providerStateId: "synthetic-cancelled" },
              ],
            },
            attributeMappings: invalidMapping ? [] : [
              { canonicalKey: ReservationFields.ReservationId, providerFieldId: RESERVATION_FIELD },
            ],
          },
        },
        pms: { provider: "browser" },
      },
    },
    requestId: "synthetic-reservation-delivery",
    receivedAt: new Date("2030-01-01T00:00:00.000Z"),
    integrationRuntime: mock.runtime,
  };
}

async function createFixture(options: {
  enabled?: boolean;
  eventRevision?: number;
  reservationRevision?: number;
  destinationTenant?: string;
  eventType?: string;
  invalidMapping?: boolean;
} = {}): Promise<Fixture> {
  const db = new SQLiteD1();
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')")
    .run(TENANT, "Synthetic Tenant");
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')")
    .run("synthetic-tenant-b", "Synthetic Tenant B");
  db.sqlite.prepare("INSERT INTO integrations (id, tenant_id, provider, enabled, settings) VALUES (?, ?, ?, 1, ?)")
    .run(SOURCE, TENANT, "staah", JSON.stringify({ mode: "mock" }));
  db.sqlite.prepare("INSERT INTO integrations (id, tenant_id, provider, enabled, settings) VALUES (?, ?, ?, 1, ?)")
    .run(DESTINATION, options.destinationTenant ?? TENANT, "gohighlevel", destinationSettings(options.enabled ?? true));
  db.sqlite.prepare(`INSERT INTO integration_credentials
    (tenant_id, provider, auth_type, api_key, location_id, metadata)
    VALUES (?, 'gohighlevel', 'api_key', ?, ?, ?)`)
    .run(options.destinationTenant ?? TENANT, "synthetic-unused-credential", LOCATION, JSON.stringify({ synthetic: true }));

  const reservationRevision = options.reservationRevision ?? 2;
  const reservation = {
    reservationId: "provider-reservation-001",
    provider: "staah",
    status: "CONFIRMED",
    firstName: "Synthetic",
    lastName: "Guest",
    email: "synthetic.guest@example.invalid",
    phone: "+60111111111",
    checkIn: "2030-06-01",
    checkOut: "2030-06-02",
  };
  await new ReservationRecordRepository(db as unknown as D1Database).persistProviderReservation({
    tenantId: TENANT,
    canonicalReservationId: CANONICAL_ID,
    provider: "staah",
    providerConnectionId: SOURCE,
    providerPropertyId: "mock-property-001",
    providerReservationId: reservation.reservationId,
    revision: reservationRevision,
    lifecycle: "confirmed",
    payload: JSON.stringify(reservation),
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });

  const events = new IntegrationEventRepository(db as unknown as D1Database);
  const eventId = `reservation-event-${crypto.randomUUID()}`;
  await events.create({
    eventId,
    tenantId: TENANT,
    eventType: options.eventType ?? "reservation.updated",
    aggregateType: "reservation",
    aggregateId: CANONICAL_ID,
    provider: "staah",
    revision: options.eventRevision ?? reservationRevision,
    occurredAt: "2030-01-01T00:00:00.000Z",
    receivedAt: "2030-01-01T00:00:01.000Z",
    payload: JSON.stringify({
      canonicalReservationId: CANONICAL_ID,
      sourceIntegrationId: SOURCE,
      destinationIntegrationId: DESTINATION,
    }),
  });

  const mock = createGHLMockEnvironment({
    tenantId: TENANT,
    locationId: LOCATION,
    reservationFieldId: RESERVATION_FIELD,
  });
  const consumer = new ReservationIntegrationEventConsumer({
    db: db as unknown as D1Database,
    destinationAdapter: goHighLevelAdapter,
    createDestinationContext: () => makeContext(mock, TENANT, LOCATION, options.invalidMapping),
  });
  return { db, events, service: new IntegrationEventService(events), consumer, mock, eventId };
}

async function persistedEvent(fixture: Fixture) {
  const event = await fixture.events.find(TENANT, fixture.eventId);
  assert.ok(event);
  return event;
}

test("durable reservation event dispatches through existing GHL adapter and is duplicate safe", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  let globalFetchCalls = 0;
  globalThis.fetch = async () => {
    globalFetchCalls += 1;
    throw new Error("External network is unavailable in reservation consumer tests.");
  };
  try {
    const first = await processReservationIntegrationEvent(
      await persistedEvent(fixture), fixture.service, fixture.consumer,
    );
    assert.equal(first.state, "delivered");
    assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
    const duplicate = await processReservationIntegrationEvent(
      await persistedEvent(fixture), fixture.service, fixture.consumer,
    );
    assert.equal(duplicate.state, "already_processed");
    assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });

    const reservations = new ReservationRecordRepository(fixture.db as unknown as D1Database);
    const current = await reservations.find(TENANT, CANONICAL_ID);
    assert.ok(current?.providerConnectionId && current.providerPropertyId);
    const updatedPayload = {
      ...(JSON.parse(current.payload) as Record<string, unknown>),
      checkOut: "2030-06-03",
    };
    const revisionWrite = await reservations.persistProviderReservation({
      ...current,
      providerConnectionId: current.providerConnectionId,
      providerPropertyId: current.providerPropertyId,
      revision: 3,
      payload: JSON.stringify(updatedPayload),
    });
    assert.equal(["inserted", "updated"].includes(revisionWrite), true);
    const updateEventId = "reservation-event-revision-3";
    await fixture.events.create({
      eventId: updateEventId,
      tenantId: TENANT,
      eventType: "reservation.updated",
      aggregateType: "reservation",
      aggregateId: CANONICAL_ID,
      provider: "staah",
      revision: 3,
      occurredAt: "2030-01-02T00:00:00.000Z",
      receivedAt: "2030-01-02T00:00:01.000Z",
      payload: JSON.stringify({
        canonicalReservationId: CANONICAL_ID,
        sourceIntegrationId: SOURCE,
        destinationIntegrationId: DESTINATION,
      }),
    });
    const updateEvent = await fixture.events.find(TENANT, updateEventId);
    assert.ok(updateEvent);
    const update = await processReservationIntegrationEvent(updateEvent, fixture.service, fixture.consumer);
    assert.equal(update.state, "delivered");
    assert.equal(update.contactId, first.state === "delivered" ? first.contactId : "");
    assert.equal(update.opportunityId, first.state === "delivered" ? first.opportunityId : "");
    assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
    assert.equal(globalFetchCalls, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count, 2);
    assert.equal((await fixture.events.find(TENANT, fixture.eventId))?.processingStatus, "processed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial mock destination failure retries safely without duplicate contact or opportunity", async () => {
  const fixture = await createFixture();
  fixture.mock.failNext("opportunity_upsert", "transient");
  await assert.rejects(
    processReservationIntegrationEvent(await persistedEvent(fixture), fixture.service, fixture.consumer),
    (error: unknown) => error instanceof IntegrationEventProcessingError && error.retryable,
  );
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 0 });
  assert.equal((await fixture.events.find(TENANT, fixture.eventId))?.processingStatus, "failed");

  const retry = await processReservationIntegrationEvent(
    await persistedEvent(fixture), fixture.service, fixture.consumer,
  );
  assert.equal(retry.state, "delivered");
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
  assert.equal((await fixture.events.find(TENANT, fixture.eventId))?.processingAttempts, 2);
});

test("permanent destination rejection uses existing dead-letter machinery", async () => {
  const fixture = await createFixture({ enabled: false });
  await assert.rejects(
    processReservationIntegrationEvent(await persistedEvent(fixture), fixture.service, fixture.consumer),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "PROVIDER_REQUEST_REJECTED" && !error.retryable,
  );
  const event = await fixture.events.find(TENANT, fixture.eventId);
  assert.equal(event?.processingStatus, "dead_letter");
  assert.equal(event?.lastErrorCode, "PROVIDER_REQUEST_REJECTED");
  assert.equal(fixture.db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters WHERE event_id = ?",
  ).get(fixture.eventId)?.count, 1);
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
});

test("invalid destination mapping is classified as a permanent normalization failure", async () => {
  const fixture = await createFixture({ invalidMapping: true });
  await assert.rejects(
    processReservationIntegrationEvent(await persistedEvent(fixture), fixture.service, fixture.consumer),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "PROVIDER_NORMALIZATION_FAILED" && !error.retryable,
  );
  const event = await fixture.events.find(TENANT, fixture.eventId);
  assert.equal(event?.processingStatus, "dead_letter");
  assert.equal(event?.lastErrorCode, "PROVIDER_NORMALIZATION_FAILED");
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
});

test("retryable destination failures are bounded by the existing attempt policy", async () => {
  const fixture = await createFixture();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    fixture.mock.failNext("contact_upsert", "transient");
    await assert.rejects(
      processReservationIntegrationEvent(await persistedEvent(fixture), fixture.service, fixture.consumer),
      (error: unknown) => error instanceof IntegrationEventProcessingError && error.retryable,
    );
  }
  const exhausted = await fixture.events.find(TENANT, fixture.eventId);
  assert.ok(exhausted);
  assert.equal(exhausted?.processingStatus, "dead_letter");
  assert.equal(exhausted?.processingAttempts, 5);
  assert.equal(fixture.db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters WHERE event_id = ?",
  ).get(fixture.eventId)?.count, 1);
  const replay = await processReservationIntegrationEvent(exhausted, fixture.service, fixture.consumer);
  assert.equal(replay.state, "already_processed");
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
});

test("stale events complete as no-op while a newer committed revision delivers", async () => {
  const stale = await createFixture({ eventRevision: 1, reservationRevision: 2 });
  const staleResult = await processReservationIntegrationEvent(
    await persistedEvent(stale), stale.service, stale.consumer,
  );
  assert.equal(staleResult.state, "stale");
  assert.deepEqual(stale.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
  assert.equal((await stale.events.find(TENANT, stale.eventId))?.processingStatus, "processed");

  const current = await createFixture({ eventRevision: 3, reservationRevision: 3 });
  const currentResult = await processReservationIntegrationEvent(
    await persistedEvent(current), current.service, current.consumer,
  );
  assert.equal(currentResult.state, "delivered");
  assert.deepEqual(current.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
});

test("cross-tenant destination, unsupported type, and future revision fail closed", async () => {
  const crossTenant = await createFixture({ destinationTenant: "synthetic-tenant-b" });
  await assert.rejects(
    processReservationIntegrationEvent(
      await persistedEvent(crossTenant), crossTenant.service, crossTenant.consumer,
    ),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "TENANT_CONTEXT_INVALID",
  );
  assert.deepEqual(crossTenant.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });

  const unsupported = await createFixture({ eventType: "messaging.inbound" });
  assert.equal(unsupported.consumer.supports("messaging.inbound"), false);
  await assert.rejects(
    processReservationIntegrationEvent(
      await persistedEvent(unsupported), unsupported.service, unsupported.consumer,
    ),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "PROVIDER_UNSUPPORTED",
  );

  const future = await createFixture({ eventRevision: 3, reservationRevision: 2 });
  await assert.rejects(
    processReservationIntegrationEvent(await persistedEvent(future), future.service, future.consumer),
    (error: unknown) => error instanceof IntegrationEventProcessingError && error.code === "INVALID_EVENT",
  );
});

test("trusted composition rejects missing location ownership and live destination context", async () => {
  const missingOwnership = await createFixture();
  missingOwnership.db.sqlite.prepare(
    "DELETE FROM integration_credentials WHERE tenant_id = ? AND provider = 'gohighlevel'",
  ).run(TENANT);
  await assert.rejects(
    processReservationIntegrationEvent(
      await persistedEvent(missingOwnership), missingOwnership.service, missingOwnership.consumer,
    ),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "TENANT_CONTEXT_INVALID",
  );

  const liveContext = await createFixture();
  const consumer = new ReservationIntegrationEventConsumer({
    db: liveContext.db as unknown as D1Database,
    destinationAdapter: goHighLevelAdapter,
    createDestinationContext: () => ({
      ...makeContext(liveContext.mock),
      integrationRuntime: {
        credentials: {
          async resolve() {
            throw new Error("Live credential resolution must remain unreachable.");
          },
        },
      },
    }),
  });
  await assert.rejects(
    processReservationIntegrationEvent(await persistedEvent(liveContext), liveContext.service, consumer),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "TENANT_CONTEXT_INVALID",
  );
  assert.deepEqual(liveContext.mock.snapshot(), { contactCount: 0, opportunityCount: 0 });
});

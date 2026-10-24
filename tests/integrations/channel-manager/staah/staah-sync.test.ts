import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Hono } from "hono";
import type { D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { hashApiKey } from "../../../../src/core/security/api-key";
import { ReservationRecordRepository } from "../../../../src/persistence/repositories/reservation-record-repository";
import type { ReservationRecord } from "../../../../src/persistence/models/reservation-record";
import {
  STAAHConnectionManagementService,
  STAAHManagementError,
  type STAAHSyncCheckpoint,
} from "../../../../src/integrations/channel-manager/staah/staah-management";
import { STAAHMockSynchronizationService, STAAHSyncError } from "../../../../src/integrations/channel-manager/staah/staah-sync";
import staahRoutes from "../../../../src/integrations/channel-manager/staah/staah-routes";
import { normalizeSTAAHReservation, buildDefaultSTAAHResourceMappings } from "../../../../src/integrations/channel-manager/staah/normalization";
import { resolveSTAAHAdapter } from "../../../../src/integrations/channel-manager/staah";
import { ReservationIntegrationEventConsumer } from "../../../../src/domain/reservation/integration-event-consumer";
import { IntegrationEventRepository } from "../../../../src/persistence/repositories/integration-event-repository";
import { createGHLMockEnvironment } from "../../../../src/integrations/crm/gohighlevel/testing/mock-transport";
import { goHighLevelAdapter } from "../../../../src/integrations/crm/gohighlevel/adapter";
import type { RequestContext } from "../../../../src/context";
import type { GHLInboundQueueEnvelope } from "../../../../src/domain/messaging/inbound-queue-contract";
import { createWorker } from "../../../../src/index";
import { createLocalSTAAHMockWorker } from "../../../../src/integrations/channel-manager/staah/staah-local-mock";
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  private batchTail: Promise<unknown> = Promise.resolve();

    constructor(schema: "core" | "mock-booking" = "core") {
    if (schema === "mock-booking") {
      this.sqlite.exec(
        readFileSync(
          join(
            process.cwd(),
            "tests",
            "fixtures",
            "staah-mock-booking-schema.sql",
          ),
          "utf8",
        ),
      );
      return;
    }

    for (const filename of
      readdirSync(join(process.cwd(), "migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
      this.sqlite.exec(
        readFileSync(join(process.cwd(), "migrations", filename), "utf8"),
      );
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
    // D1 batches are serialized transactions, including under concurrent callers.
    const transaction = this.batchTail.then(async () => {
      this.sqlite.exec("BEGIN");
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) results.push(await statement.run<T>());
        this.sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    });
    this.batchTail = transaction.catch(() => undefined);
    return transaction;
  }
}

async function createFixture(mockFailureScenario = "none") {
  const db = new SQLiteD1();
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)").run("tenant-a", "Synthetic Tenant", "active");
  const apiKeyHash = await hashApiKey("fl360_staah_mock_test_key");
  db.sqlite.prepare(`INSERT INTO clients (id, tenant_id, name, api_key_hash, status, permissions)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("client-a", "tenant-a", "Mock Test Client", apiKeyHash, "active", JSON.stringify(["integrations:read", "integrations:write"]));

  const management = new STAAHConnectionManagementService(db as unknown as D1Database);
  const configured = await management.configure("tenant-a", {
    syntheticPropertyId: "mock-property-001",
    mockFailureScenario,
  });
  const integrationId = configured.connection.integrationId;
  assert.ok(integrationId);
  await management.verify("tenant-a", integrationId);

  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.route("/channel-manager/staah", staahRoutes);
  const bindings = { DB: db as unknown as D1Database } as AppBindings;
  const headers = { Authorization: "Bearer fl360_staah_mock_test_key", "Content-Type": "application/json" };
  return { db, management, integrationId, app, bindings, headers };
}

async function createUnconfiguredRouteFixture() {
  const db = new SQLiteD1();
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)")
    .run("tenant-a", "Synthetic Tenant A", "active");
  db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)")
    .run("tenant-b", "Synthetic Tenant B", "active");
  const keyA = "fl360_staah_acceptance_a";
  const keyB = "fl360_staah_acceptance_b";
  const insertClient = db.sqlite.prepare(`INSERT INTO clients
    (id, tenant_id, name, api_key_hash, status, permissions) VALUES (?, ?, ?, ?, ?, ?)`);
  insertClient.run("client-a", "tenant-a", "Synthetic Client A", await hashApiKey(keyA), "active",
    JSON.stringify(["integrations:read", "integrations:write"]));
  insertClient.run("client-b", "tenant-b", "Synthetic Client B", await hashApiKey(keyB), "active",
    JSON.stringify(["integrations:read", "integrations:write"]));

  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.route("/channel-manager/staah", staahRoutes);
  return {
    db,
    app,
    bindings: { DB: db as unknown as D1Database } as AppBindings,
    headersA: { Authorization: `Bearer ${keyA}`, "Content-Type": "application/json" },
    headersB: { Authorization: `Bearer ${keyB}`, "Content-Type": "application/json" },
  };
}

function atomicRecord(revision = 1) {
  return {
    tenantId: "tenant-a", canonicalReservationId: crypto.randomUUID(), provider: "staah",
    providerConnectionId: "source-atomic", providerPropertyId: "mock-property",
    providerReservationId: "synthetic-reservation", revision, lifecycle: "confirmed",
    payload: JSON.stringify({ revision }), createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
  };
}

function eventCount(db: SQLiteD1): number {
  return Number(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count);
}

test("atomic producer emits insert, higher revision and cancellation, not replay/stale/conflict", async () => {
  const fixture = await createFixture();
  const repository = new ReservationRecordRepository(fixture.db as unknown as D1Database);
  const original = atomicRecord();
  const created = await repository.persistProviderReservationWithEvent(original, "mock-destination");
  assert.equal(created.outcome, "inserted");
  assert.ok(created.eventId?.startsWith("evt_"));
  const higher = { ...original, canonicalReservationId: crypto.randomUUID(), revision: 2, payload: '{"revision":2}' };
  assert.equal((await repository.persistProviderReservationWithEvent(higher, "mock-destination")).outcome, "updated");
  assert.equal((await repository.persistProviderReservationWithEvent(higher, "mock-destination")).outcome, "unchanged");
  assert.equal((await repository.persistProviderReservationWithEvent(original, "mock-destination")).outcome, "stale");
  assert.equal((await repository.persistProviderReservationWithEvent({ ...higher, payload: '{"conflict":true}' }, "mock-destination")).outcome, "conflict");
  assert.equal(eventCount(fixture.db), 2);
  const cancelled = { ...higher, revision: 3, lifecycle: "cancelled", payload: '{"cancelled":true}' };
  assert.equal((await repository.persistProviderReservationWithEvent(cancelled, "mock-destination")).outcome, "updated");
  const rows = fixture.db.sqlite.prepare("SELECT event_type, aggregate_id, payload FROM integration_events ORDER BY revision").all();
  assert.deepEqual(rows.map(row => row.event_type), ["reservation.created", "reservation.updated", "reservation.cancelled"]);
  assert.equal(rows.every(row => row.aggregate_id === original.canonicalReservationId), true);
  assert.equal(rows.every(row => Object.keys(JSON.parse(String(row.payload))).sort().join() ===
    "canonicalReservationId,destinationIntegrationId,sourceIntegrationId"), true);
});

for (const failure of ["reservation_insert", "event_insert", "event_update"] as const) {
  test(`atomic producer rolls back both sides on ${failure} failure`, async () => {
    const fixture = await createFixture();
    const db = fixture.db;
    const repository = new ReservationRecordRepository(db as unknown as D1Database);
    const record = atomicRecord();
    if (failure === "event_update") await repository.persistProviderReservationWithEvent(record, "mock-destination");
    db.sqlite.exec(failure === "reservation_insert"
      ? `CREATE TRIGGER fail_write BEFORE INSERT ON reservation_records BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`
      : `CREATE TRIGGER fail_event BEFORE INSERT ON integration_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    await assert.rejects(repository.persistProviderReservationWithEvent(
      failure === "event_update" ? { ...record, revision: 2, payload: '{"revision":2}' } : record, "mock-destination",
    ));
    assert.equal(eventCount(db), failure === "event_update" ? 1 : 0);
    const saved = await repository.find(record.tenantId, record.canonicalReservationId);
    assert.equal(saved?.revision ?? null, failure === "event_update" ? 1 : null);
  });
}

test("atomic producer serializes concurrent revisions and duplicate identities", async () => {
  const fixture = await createFixture();
  const repository = new ReservationRecordRepository(fixture.db as unknown as D1Database);
  const first = atomicRecord();
  const results = await Promise.all([
    repository.persistProviderReservationWithEvent(first, "mock-destination"),
    repository.persistProviderReservationWithEvent({ ...first, canonicalReservationId: crypto.randomUUID() }, "mock-destination"),
    repository.persistProviderReservationWithEvent({ ...first, canonicalReservationId: crypto.randomUUID(), revision: 2, payload: '{"revision":2}' }, "mock-destination"),
  ]);
  assert.equal(results.filter(result => result.outcome === "inserted").length, 1);
  assert.equal(results.filter(result => result.outcome === "updated").length, 1);
  assert.equal(eventCount(fixture.db), 2);
  assert.equal((await repository.find(first.tenantId, first.canonicalReservationId))?.revision, 2);
  const zeroRow = await repository.persistProviderReservationWithEvent(first, "another-destination");
  assert.equal(zeroRow.outcome, "stale");
  assert.equal(zeroRow.eventId, undefined);
  assert.equal(eventCount(fixture.db), 2);
});

async function bridgeFixture(scenario = "none") {
  const fixture = await createFixture(scenario);
  const destinationId = "mock-ghl-destination";
  const locationId = "mock-ghl-location";
  const settings = {
    reservationEventDelivery: {
      enabled: true, mode: "mock", sourceIntegrationIds: [fixture.integrationId], locationId,
    },
  };
  fixture.db.sqlite.prepare(`INSERT INTO integrations(id,tenant_id,provider,enabled,settings)
    VALUES (?, 'tenant-a', 'gohighlevel', 1, ?)`).run(destinationId, JSON.stringify(settings));
  fixture.db.sqlite.prepare(`INSERT INTO integration_credentials(tenant_id,provider,api_key,location_id)
    VALUES ('tenant-a','gohighlevel','synthetic-never-read',?)`).run(locationId);
  const mock = createGHLMockEnvironment({ tenantId: "tenant-a", locationId, reservationFieldId: "mock-reservation-field" });
  const context: RequestContext = {
    client: { id: "mock-internal", tenantId: "tenant-a", name: "Mock", apiKey: "synthetic", status: "active", permissions: [] },
    tenant: {
      id: "tenant-a", name: "Mock", status: "active",
      integrations: {
        pms: { provider: "browser" },
        crm: {
          id: destinationId, provider: "gohighlevel", credentials: { locationId },
          configuration: {
            workflow: { key: "mock", providerWorkflowId: "mock-pipeline",
              states: [{ key: "new_booking", providerStateId: "mock-new" }, { key: "cancelled", providerStateId: "mock-cancelled" }] },
            attributeMappings: [{ canonicalKey: "reservation.id", providerFieldId: "mock-reservation-field" }],
          },
        },
      },
    },
    requestId: "mock-reservation-dispatch", receivedAt: new Date(), integrationRuntime: mock.runtime,
  };
  const consumer = new ReservationIntegrationEventConsumer({
    db: fixture.db as unknown as D1Database, destinationAdapter: goHighLevelAdapter,
    createDestinationContext: () => context,
  });
  const envelopes: GHLInboundQueueEnvelope[] = [];
  let enqueueFailure = false;
  const queue = {
    async send(envelope: GHLInboundQueueEnvelope) {
      if (enqueueFailure) throw new Error("Synthetic Queue outage");
      envelopes.push(envelope);
      return {
        metadata: {
          metrics: {
            backlogCount: 0,
            backlogBytes: 0,
          },
        },
      };
    },
  } as Pick<Queue<GHLInboundQueueEnvelope>, "send">;
  const env = { ...fixture.bindings, NEW_QUEUE_ENVELOPES_ENABLED: "true", GHL_INBOUND_QUEUE: queue } as AppBindings;
  const worker = createWorker(consumer);
  const execution = { waitUntil() {} } as unknown as ExecutionContext;
  const sync = new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database, fixture.management,
    new ReservationRecordRepository(fixture.db as unknown as D1Database), { consumer, queue },
  );
  async function dispatch(envelope: GHLInboundQueueEnvelope) {
    let outcome = "";
    const batch = { messages: [{
      body: envelope, id: "mock-queue-id", timestamp: new Date(), attempts: 1,
      ack() { outcome = "acked"; }, retry() { outcome = "retry"; },
    }] } as unknown as MessageBatch<GHLInboundQueueEnvelope>;
    await worker.queue?.(batch, env, execution);
    return outcome;
  }
  async function recover() {
    await worker.scheduled?.({} as ScheduledController, env, execution);
  }
  return { ...fixture, consumer, context, settings, destinationId, mock, sync, envelopes, env,
    dispatch, recover, failEnqueue(value: boolean) { enqueueFailure = value; } };
}

test("STAAH sync commits intents and actual Worker Queue dispatch reaches the mock consumer", async () => {
  const fixture = await bridgeFixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    throw new Error("External network prohibited");
  };

  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => logs.push(values);

  try {
    const result = await fixture.sync.synchronize(
      "tenant-a",
      fixture.integrationId,
    );

    assert.equal(result.checkpoint.status, "succeeded");
    assert.equal(result.counts.insertedCount, 3);
    assert.equal(result.counts.updatedCount, 2);

    // Three creations and two legitimate reservation updates.
    assert.equal(eventCount(fixture.db), 5);
    assert.equal(fixture.envelopes.length, 5);

    for (const envelope of fixture.envelopes) {
      assert.deepEqual(
        Object.keys(envelope).sort(),
        ["kind", "sourceEventId", "tenantId", "version"],
      );

      assert.equal(await fixture.dispatch(envelope), "acked");

      // Repeated delivery must remain idempotent.
      assert.equal(await fixture.dispatch(envelope), "acked");
    }

    assert.deepEqual(fixture.mock.snapshot(), {
      contactCount: 3,
      opportunityCount: 3,
    });

    assert.equal(
      fixture.db.sqlite
        .prepare(
          "SELECT count(*) AS count FROM integration_events WHERE processing_status='processed'",
        )
        .get()?.count,
      5,
    );

    // Replaying the same STAAH data must not create new events.
    await fixture.sync.synchronize(
      "tenant-a",
      fixture.integrationId,
    );

    assert.equal(eventCount(fixture.db), 5);
    assert.equal(fixture.envelopes.length, 5);
    assert.equal(calls, 0);

    const serialized = JSON.stringify([
      logs,
      fixture.envelopes,
      fixture.db.sqlite
        .prepare("SELECT payload FROM integration_events")
        .all(),
    ]);

    assert.doesNotMatch(
      serialized,
      /alex\.mock|jamie\.sample|morgan\.test|synthetic-never-read|synthetic-ghl-mock-token/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("committed enqueue failures recover through Worker scheduled callback without another sync", async () => {
  const fixture = await bridgeFixture();

  fixture.failEnqueue(true);

  const result = await fixture.sync.synchronize(
    "tenant-a",
    fixture.integrationId,
  );

  assert.equal(result.checkpoint.status, "succeeded");

  // Three created reservations + two reservation updates.
  assert.equal(eventCount(fixture.db), 5);

  // Queue failure should not lose committed events.
  assert.equal(fixture.envelopes.length, 0);

  fixture.failEnqueue(false);

  // Recover committed events without repeating the STAAH sync.
  await fixture.recover();

  assert.equal(fixture.envelopes.length, 5);

  for (const envelope of fixture.envelopes) {
    assert.equal(await fixture.dispatch(envelope), "acked");
  }

  fixture.envelopes.length = 0;

  // Processed events should not be re-enqueued.
  await fixture.recover();

  assert.equal(fixture.envelopes.length, 0);
});

test("actual Queue retries contact success/opportunity failure without duplicate mock records", async () => {
  const fixture = await bridgeFixture();
  await fixture.sync.synchronize("tenant-a", fixture.integrationId);
  const envelope = fixture.envelopes[1]; // latest revision of first synthetic reservation
  assert.ok(envelope);
  fixture.mock.failNext("opportunity_upsert", "transient");
  assert.equal(await fixture.dispatch(envelope), "retry");
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 0 });
  assert.equal(await fixture.dispatch(envelope), "acked");
  assert.equal(await fixture.dispatch(envelope), "acked");
  assert.deepEqual(fixture.mock.snapshot(), { contactCount: 1, opportunityCount: 1 });
  const event = await new IntegrationEventRepository(fixture.db as unknown as D1Database)
    .find("tenant-a", envelope.sourceEventId);
  assert.equal(event?.processingAttempts, 2);
});

for (
  const rejection of [
    "disabled",
    "wrong_tenant",
    "missing_location",
    "live_route",
    "live_context",
    "missing_transport",
    "source_not_allowed",
  ] as const
) {
  test(
    `producer rejects ${rejection} before canonical/event persistence`,
    async () => {
      const fixture = await bridgeFixture();

      if (rejection === "disabled") {
        fixture.db.sqlite.exec(
          "UPDATE integrations SET enabled=0 WHERE provider='gohighlevel'",
        );
      }

      if (rejection === "wrong_tenant") {
        fixture.db.sqlite.exec(
          "INSERT INTO tenants(id,name,status) VALUES('tenant-b','Synthetic B','active')",
        );

        // Scope the update to tenant-a to avoid changing
        // the seeded fusionlab360 GHL integration.
        fixture.db.sqlite.exec(
          "UPDATE integrations SET tenant_id='tenant-b' WHERE provider='gohighlevel' AND tenant_id='tenant-a'",
        );
      }

      if (rejection === "missing_location") {
        fixture.db.sqlite.exec(
          "DELETE FROM integration_credentials WHERE provider='gohighlevel'",
        );
      }

      if (rejection === "live_route") {
        fixture.db.sqlite
          .prepare(
            "UPDATE integrations SET settings=? WHERE provider='gohighlevel'",
          )
          .run(
            JSON.stringify({
              reservationEventDelivery: {
                ...fixture.settings.reservationEventDelivery,
                mode: "live",
              },
            }),
          );
      }

      if (rejection === "live_context") {
        fixture.context.integrationRuntime.transportMode = undefined;
      }

      if (rejection === "missing_transport") {
        fixture.context.integrationRuntime.httpTransport = undefined;
      }

      if (rejection === "source_not_allowed") {
        fixture.db.sqlite
          .prepare(
            "UPDATE integrations SET settings=? WHERE provider='gohighlevel'",
          )
          .run(
            JSON.stringify({
              reservationEventDelivery: {
                ...fixture.settings.reservationEventDelivery,
                sourceIntegrationIds: [],
              },
            }),
          );
      }

      await assert.rejects(
        fixture.sync.synchronize(
          "tenant-a",
          fixture.integrationId,
        ),
      );

      assert.equal(eventCount(fixture.db), 0);
      assert.equal(fixture.envelopes.length, 0);

      assert.equal(
        fixture.db.sqlite
          .prepare("SELECT count(*) AS count FROM reservation_records")
          .get()?.count,
        0,
      );

      assert.deepEqual(fixture.mock.snapshot(), {
        contactCount: 0,
        opportunityCount: 0,
      });
    },
  );
}

test("persisted permission alone cannot activate production mock delivery", async () => {
  const fixture = await bridgeFixture();
  await new STAAHMockSynchronizationService(fixture.db as unknown as D1Database)
    .synchronize("tenant-a", fixture.integrationId);
  assert.equal(eventCount(fixture.db), 0);
  assert.equal(fixture.envelopes.length, 0);
});

test("partial STAAH batch retains prior atomic work and accurate checkpoint", async () => {
  const fixture = await bridgeFixture("partial_batch_failure");
  await assert.rejects(fixture.sync.synchronize("tenant-a", fixture.integrationId));
  const checkpoint = (await fixture.management.loadOperationalConnection("tenant-a", fixture.integrationId)).syncCheckpoint;
  assert.equal(checkpoint.status, "failed");
  assert.ok(checkpoint.processedCount > 0);
  assert.equal(eventCount(fixture.db), checkpoint.insertedCount + checkpoint.updatedCount);
  assert.equal(fixture.envelopes.length, eventCount(fixture.db));
  for (const envelope of fixture.envelopes) assert.equal(await fixture.dispatch(envelope), "acked");
});

test("recovery excludes active leases and dead letters and reclaims expired attempts", async () => {
  const fixture = await bridgeFixture();

  await fixture.sync.synchronize(
    "tenant-a",
    fixture.integrationId,
  );

  // The current mock batch emits five legitimate events.
  const [first, second, third, fourth, fifth] = fixture.envelopes;

  assert.ok(first && second && third && fourth && fifth);

  // Dead-lettered events must not be recovered.
  fixture.db.sqlite
    .prepare(
      "UPDATE integration_events SET processing_status='dead_letter' WHERE event_id=?",
    )
    .run(first.sourceEventId);

  // An active lease must be excluded.
  fixture.db.sqlite
    .prepare(`
      UPDATE integration_events
      SET processing_status='processing',
          processing_lease_expires_at='2099-01-01T00:00:00.000Z'
      WHERE event_id=?
    `)
    .run(second.sourceEventId);

  // An expired lease must be recoverable.
  fixture.db.sqlite
    .prepare(`
      UPDATE integration_events
      SET processing_status='processing',
          processing_attempts=1,
          processing_lease_expires_at='2000-01-01T00:00:00.000Z'
      WHERE event_id=?
    `)
    .run(third.sourceEventId);

  fixture.envelopes.length = 0;

  await fixture.recover();

  // Third: expired lease
  // Fourth and fifth: received events
  // First: dead letter, excluded
  // Second: active lease, excluded
  assert.deepEqual(
    new Set(
      fixture.envelopes.map(
        (event) => event.sourceEventId,
      ),
    ),
    new Set([
      third.sourceEventId,
      fourth.sourceEventId,
      fifth.sourceEventId,
    ]),
  );

  assert.equal(await fixture.dispatch(first), "acked");
  assert.equal(await fixture.dispatch(second), "retry");
  assert.equal(await fixture.dispatch(third), "acked");

  const recoveredEvent = await new IntegrationEventRepository(
    fixture.db as unknown as D1Database,
  ).find("tenant-a", third.sourceEventId);

  assert.equal(recoveredEvent?.processingAttempts, 2);
});

test("mock property retrieval returns tenant- and connection-scoped room and rate mappings", async () => {
  const { app, bindings, headers, integrationId, db } = await createFixture();
  const response = await app.request(`/channel-manager/staah/${integrationId}/property`, { headers }, bindings);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    property: { providerPropertyId: string; rooms: unknown[]; ratePlans: unknown[] };
    mappings: Array<{ tenantId: string; integrationId: string; providerPropertyId: string; resourceType: string }>;
  };
  assert.equal(body.property.providerPropertyId, "mock-property-001");
  assert.equal(body.property.rooms.length, 2);
  assert.equal(body.property.ratePlans.length, 2);
  assert.equal(body.mappings.length, 5);
  assert.equal(body.mappings.every((mapping) => mapping.tenantId === "tenant-a" &&
    mapping.integrationId === integrationId && mapping.providerPropertyId === "mock-property-001"), true);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 0);
  const settings = JSON.parse((db.sqlite.prepare("SELECT settings FROM integrations WHERE id = ?")
    .get(integrationId) as { settings: string }).settings) as { resourceMappings: unknown[] };
  assert.equal(settings.resourceMappings.length, 0);
});

test("authorized route synchronizes normalized reservations durably, idempotently, without consumer events", async () => {
  const { app, bindings, headers, integrationId, db } = await createFixture();
  db.sqlite.prepare(`INSERT INTO reservation_records (
    tenant_id, canonical_reservation_id, provider, provider_reservation_id,
    revision, lifecycle, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("tenant-a", "canonical-existing", "other-provider", "external-existing", 7, "confirmed", "{\"unchanged\":true}");
  const firstResponse = await app.request(`/channel-manager/staah/${integrationId}/sync`, {
    method: "POST", headers,
  }, bindings);
  assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE provider = 'staah'").get()?.count, 0);
  const firstBody = await firstResponse.json() as {
    sync: { checkpoint: { status: string }; counts: { processedCount: number; insertedCount: number; updatedCount: number; unchangedCount: number; rejectedCount: number } };
  };
  assert.equal(firstBody.sync.checkpoint.status, "succeeded");
  const savedSettings = JSON.parse((db.sqlite.prepare("SELECT settings FROM integrations WHERE id = ?")
    .get(integrationId) as { settings: string }).settings) as { resourceMappings: unknown[] };
  assert.equal(savedSettings.resourceMappings.length, 5);
  assert.deepEqual(firstBody.sync.counts, {
    processedCount: 8,
    insertedCount: 3,
    updatedCount: 2,
    unchangedCount: 1,
    rejectedCount: 2,
  });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE tenant_id = ? AND provider = 'staah'").get("tenant-a")?.count, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count, 0);
  const current = db.sqlite.prepare(`SELECT canonical_reservation_id, revision, lifecycle, provider_connection_id, provider_property_id, payload
    FROM reservation_records WHERE tenant_id = ? AND provider_reservation_id = ?`)
    .get("tenant-a", "mock-res-002") as { canonical_reservation_id: string; revision: number; lifecycle: string; provider_connection_id: string; provider_property_id: string; payload: string };
  assert.equal(current.revision, 2);
  assert.equal(current.lifecycle, "cancelled");
  assert.equal(current.provider_connection_id, integrationId);
  assert.equal(current.provider_property_id, "mock-property-001");
  const canonicalRow = await new ReservationRecordRepository(db as unknown as D1Database)
    .find("tenant-a", current.canonical_reservation_id);
  assert.equal(canonicalRow?.providerConnectionId, integrationId);
  assert.equal(canonicalRow?.providerPropertyId, "mock-property-001");
  const untouched = db.sqlite.prepare("SELECT provider_reservation_id, payload FROM reservation_records WHERE canonical_reservation_id = ?")
    .get("canonical-existing") as { provider_reservation_id: string; payload: string };
  assert.deepEqual({ ...untouched }, { provider_reservation_id: "external-existing", payload: "{\"unchanged\":true}" });
  const newest = db.sqlite.prepare(`SELECT revision, payload FROM reservation_records
    WHERE tenant_id = ? AND provider = 'staah' AND provider_reservation_id = ?`)
    .get("tenant-a", "mock-res-003") as { revision: number; payload: string };
  assert.equal(newest.revision, 3);
  assert.equal((JSON.parse(newest.payload) as { checkIn: string }).checkIn, "2030-06-01");
  const health = await new STAAHConnectionManagementService(db as unknown as D1Database)
    .inspect("tenant-a", integrationId);
  assert.equal(health.connectionHealth.state, "mock_verified");
  assert.equal(health.syncDiagnostics.state, "succeeded");
  assert.equal(health.syncDiagnostics.lastSuccessfulSyncAt, health.syncDiagnostics.lastAttemptCompletedAt);
  assert.equal(health.syncDiagnostics.inProgress, false);
  assert.equal(health.syncDiagnostics.retryEligibility, "eligible");
  const repeated = await app.request(`/channel-manager/staah/${integrationId}/sync`, {
    method: "POST", headers,
  }, bindings);
  assert.equal(repeated.status, 200);
  const repeatedBody = await repeated.json() as { sync: { counts: { insertedCount: number; updatedCount: number; unchangedCount: number } } };
  assert.equal(repeatedBody.sync.counts.insertedCount, 0);
  assert.equal(repeatedBody.sync.counts.updatedCount, 0);
  assert.equal(repeatedBody.sync.counts.unchangedCount, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE provider = 'staah'").get()?.count, 3);
});

test("repository distinguishes revision insert, replay, update, stale data, conflict, cancellation, and concurrent writes", async () => {
  const { db, integrationId } = await createFixture();
  const repository = new ReservationRecordRepository(db as unknown as D1Database);
  const base: ReservationRecord & { providerConnectionId: string; providerPropertyId: string } = {
    tenantId: "tenant-a",
    canonicalReservationId: "canonical-revision-test",
    provider: "staah",
    providerConnectionId: integrationId,
    providerPropertyId: "mock-property-001",
    providerReservationId: "mock-revision-test",
    revision: 1,
    lifecycle: "confirmed",
    payload: "{\"state\":\"confirmed\"}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assert.equal(await repository.persistProviderReservation(base), "inserted");
  assert.equal(await repository.persistProviderReservation({
    ...base,
    canonicalReservationId: "ignored-new-canonical-id",
  }), "unchanged");
  assert.equal(await repository.persistProviderReservation({
    ...base,
    canonicalReservationId: "ignored-new-canonical-id",
    revision: 2,
    lifecycle: "cancelled",
    payload: "{\"state\":\"cancelled\"}",
  }), "updated");
  assert.equal(await repository.persistProviderReservation(base), "stale");
  assert.equal(await repository.persistProviderReservation({
    ...base,
    revision: 2,
    lifecycle: "confirmed",
    payload: "{\"state\":\"different-at-same-revision\"}",
  }), "conflict");

  const current = db.sqlite.prepare(`
    SELECT canonical_reservation_id, revision, lifecycle, payload
    FROM reservation_records WHERE tenant_id = ? AND provider = ?
      AND provider_connection_id = ? AND provider_property_id = ?
      AND provider_reservation_id = ?
  `).get("tenant-a", "staah", integrationId, "mock-property-001", "mock-revision-test") as {
    canonical_reservation_id: string;
    revision: number;
    lifecycle: string;
    payload: string;
  };
  assert.deepEqual({ ...current }, {
    canonical_reservation_id: "canonical-revision-test",
    revision: 2,
    lifecycle: "cancelled",
    payload: "{\"state\":\"cancelled\"}",
  });

  const concurrentBase = {
    ...base,
    canonicalReservationId: "canonical-concurrent-revision-test",
    providerReservationId: "mock-concurrent-revision-test",
    revision: 1,
    lifecycle: "confirmed",
    payload: "{\"revision\":1}",
  };
  assert.equal(await repository.persistProviderReservation(concurrentBase), "inserted");
  await Promise.all([
    repository.persistProviderReservation({
      ...concurrentBase,
      revision: 2,
      payload: "{\"revision\":2}",
    }),
    repository.persistProviderReservation({
      ...concurrentBase,
      revision: 3,
      lifecycle: "cancelled",
      payload: "{\"revision\":3}",
    }),
  ]);
  const concurrentFinal = db.sqlite.prepare(`
    SELECT revision, lifecycle FROM reservation_records
    WHERE tenant_id = ? AND provider = ? AND provider_connection_id = ?
      AND provider_property_id = ? AND provider_reservation_id = ?
  `).get("tenant-a", "staah", integrationId, "mock-property-001", "mock-concurrent-revision-test") as {
    revision: number;
    lifecycle: string;
  };
  assert.equal(concurrentFinal.revision, 3);
  assert.equal(concurrentFinal.lifecycle, "cancelled");
});

test("revision conflicts fail sync without advancing past the conflicted reservation, then replay after resolution", async () => {
  const { db, management, integrationId, app, bindings, headers } = await createFixture();
  const repository = new ReservationRecordRepository(db as unknown as D1Database);
  await repository.persistProviderReservation({
    tenantId: "tenant-a",
    canonicalReservationId: "preexisting-conflict",
    provider: "staah",
    providerConnectionId: integrationId,
    providerPropertyId: "mock-property-001",
    providerReservationId: "mock-res-002",
    revision: 1,
    lifecycle: "confirmed",
    payload: "{\"conflicting\":true}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await app.request(`/channel-manager/staah/${integrationId}/sync`, {
      method: "POST", headers,
    }, bindings);
    assert.equal(response.status, 409);
    const errorBody = await response.json() as { code: string; message: string };
    assert.equal(errorBody.code, "reservation_revision_conflict");
    assert.equal(errorBody.message.includes("revision conflict"), true);
    const checkpoint = (await management.inspect("tenant-a", integrationId)).syncCheckpoint;
    assert.equal(checkpoint?.status, "failed");
    assert.equal(checkpoint?.lastErrorCode, "reservation_revision_conflict");
    assert.equal(checkpoint?.processedCount, 3);
    assert.equal(checkpoint?.insertedCount, attempt === 0 ? 1 : 0);
    assert.equal(checkpoint?.updatedCount, attempt === 0 ? 1 : 0);
    assert.equal(checkpoint?.unchangedCount, 1);
    assert.equal(checkpoint?.rejectedCount, attempt === 0 ? 0 : 2);
    assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM reservation_records
      WHERE tenant_id = ? AND provider = ? AND provider_reservation_id = ?`)
      .get("tenant-a", "staah", "mock-res-003")?.count, 0);
  }

  const context = { tenantId: "tenant-a", integrationId, connectionId: integrationId };
  const adapter = resolveSTAAHAdapter(context);
  const property = await adapter.getProperty(context, "mock-property-001");
  const mappings = buildDefaultSTAAHResourceMappings(context, property);
  const batch = await adapter.getReservations(context, property.providerPropertyId);
  const conflictSource = batch.reservations.find((reservation) => reservation.providerReservationId === "mock-res-002");
  assert.ok(conflictSource);
  const normalized = normalizeSTAAHReservation(context, property, mappings, conflictSource);
  db.sqlite.prepare(`UPDATE reservation_records SET lifecycle = ?, payload = ?
    WHERE tenant_id = ? AND canonical_reservation_id = ?`)
    .run("confirmed", JSON.stringify(normalized), "tenant-a", "preexisting-conflict");

  const sync = new STAAHMockSynchronizationService(db as unknown as D1Database, management);
  const recovered = await sync.synchronize("tenant-a", integrationId);
  assert.equal(recovered.checkpoint.status, "succeeded");
  assert.equal(recovered.counts.processedCount, 8);
  assert.equal(recovered.counts.insertedCount, 1);
  assert.equal(recovered.counts.unchangedCount, 2);
  assert.equal(recovered.counts.updatedCount, 1);
  assert.equal(recovered.counts.rejectedCount, 4);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM reservation_records
    WHERE tenant_id = ? AND provider = ?`).get("tenant-a", "staah")?.count, 3);
});

test("first and last repository conflicts fail with only earlier committed rows counted", async () => {
  for (const conflictAtCall of [1, 7]) {
    const fixture = await createFixture();
    class ConflictAtCallRepository extends ReservationRecordRepository {
      private calls = 0;
      override async persistProviderReservation(
        record: ReservationRecord & { providerConnectionId: string; providerPropertyId: string },
      ) {
        this.calls += 1;
        return this.calls === conflictAtCall
          ? "conflict" as const
          : super.persistProviderReservation(record);
      }
    }
    const sync = new STAAHMockSynchronizationService(
      fixture.db as unknown as D1Database,
      fixture.management,
      new ConflictAtCallRepository(fixture.db as unknown as D1Database),
    );
    await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
      error instanceof STAAHSyncError && error.status === 409,
    );
    const checkpoint = (await fixture.management.inspect("tenant-a", fixture.integrationId)).syncCheckpoint;
    assert.equal(checkpoint?.status, "failed");
    assert.equal(checkpoint?.lastErrorCode, "reservation_revision_conflict");
    assert.equal(checkpoint?.processedCount, conflictAtCall - 1);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE provider = 'staah'").get()?.count,
      conflictAtCall === 1 ? 0 : 3);
  }
});

test("wrong tenant or integration cannot retrieve or synchronize another connection", async () => {
  const { management, integrationId } = await createFixture();
  await assert.rejects(management.loadOperationalConnection("tenant-b", integrationId));
  const sync = new STAAHMockSynchronizationService({} as D1Database, management);
  await assert.rejects(sync.property("tenant-b", integrationId));
  await assert.rejects(sync.synchronize("tenant-b", integrationId));
});

test("the same provider reservation identity stays isolated by tenant and connection", async () => {
  const fixture = await createFixture();
  await new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
  ).synchronize("tenant-a", fixture.integrationId);
  fixture.db.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)")
    .run("tenant-b", "Second Synthetic Tenant", "active");
  const secondManagement = new STAAHConnectionManagementService(fixture.db as unknown as D1Database);
  const second = await secondManagement.configure("tenant-b", { syntheticPropertyId: "mock-property-001" });
  assert.ok(second.connection.integrationId);
  await secondManagement.verify("tenant-b", second.connection.integrationId);
  const sync = new STAAHMockSynchronizationService(fixture.db as unknown as D1Database, secondManagement);
  await sync.synchronize("tenant-b", second.connection.integrationId);
  assert.equal(fixture.db.sqlite.prepare(`SELECT COUNT(*) AS count FROM reservation_records
    WHERE provider = 'staah' AND provider_reservation_id = 'mock-res-001'`).get()?.count, 2);
  assert.equal(fixture.db.sqlite.prepare(`SELECT COUNT(*) AS count FROM reservation_records
    WHERE tenant_id = 'tenant-a' AND provider = 'staah'`).get()?.count, 3);
  assert.equal(fixture.db.sqlite.prepare(`SELECT COUNT(*) AS count FROM reservation_records
    WHERE tenant_id = 'tenant-b' AND provider = 'staah'`).get()?.count, 3);
});

test("disabled and unverified connections cannot synchronize", async () => {
  const { db, management, integrationId } = await createFixture();
  const sync = new STAAHMockSynchronizationService(db as unknown as D1Database, management);
  await management.update("tenant-a", integrationId, { syntheticPropertyId: "mock-property-001" });
  await assert.rejects(sync.synchronize("tenant-a", integrationId), (error: unknown) =>
    error instanceof STAAHManagementError && error.status === 409,
  );
  await management.verify("tenant-a", integrationId);
  await management.disable("tenant-a", integrationId);
  await assert.rejects(sync.synchronize("tenant-a", integrationId), (error: unknown) =>
    error instanceof STAAHManagementError && error.status === 409,
  );
});

test("disabling during sync invalidates the checkpoint and stops subsequent reservation writes", async () => {
  const fixture = await createFixture();
  let writes = 0;
  class DisableAfterFirstWrite extends ReservationRecordRepository {
    override async persistProviderReservation(record: ReservationRecord & {
      providerConnectionId: string;
      providerPropertyId: string;
    }) {
      const result = await super.persistProviderReservation(record);
      writes += 1;
      if (writes === 1) await fixture.management.disable("tenant-a", fixture.integrationId);
      return result;
    }
  }
  const sync = new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
    new DisableAfterFirstWrite(fixture.db as unknown as D1Database),
  );
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId));
  assert.equal(writes, 1);
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 1);
  let connection = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(connection.status, "disabled");
  assert.equal(connection.syncCheckpoint?.status, "failed");

  await fixture.management.enable("tenant-a", fixture.integrationId);
  await fixture.management.verify("tenant-a", fixture.integrationId);
  const recovered = await new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
  ).synchronize("tenant-a", fixture.integrationId);
  assert.equal(recovered.checkpoint.status, "succeeded");
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE provider = 'staah'").get()?.count, 3);
  connection = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(connection.syncCheckpoint?.status, "succeeded");
});

test("provider failure and partial batch failure leave durable failed checkpoints and can be replayed", async () => {
  const fixture = await createFixture("provider_unavailable");
  const sync = new STAAHMockSynchronizationService(fixture.db as unknown as D1Database, fixture.management);
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
    error instanceof STAAHSyncError && error.status === 503,
  );
  let inspected = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(inspected.syncCheckpoint?.status, "failed");
  assert.equal(inspected.syncCheckpoint?.lastErrorCode, "provider_unavailable");
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 0);

  await fixture.management.update("tenant-a", fixture.integrationId, {
    syntheticPropertyId: "mock-property-001",
    mockFailureScenario: "partial_batch_failure",
  });
  inspected = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(inspected.syncCheckpoint?.status, "failed");
  assert.equal(inspected.syncCheckpoint?.lastErrorCode, "provider_unavailable");
  await fixture.management.verify("tenant-a", fixture.integrationId);
  const partialError = await sync.synchronize("tenant-a", fixture.integrationId).then(() => null, (error: unknown) => error);
  assert.ok(partialError instanceof Error);
  inspected = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(inspected.syncCheckpoint?.status, "failed");
  assert.equal(inspected.syncCheckpoint?.lastErrorCode, "partial_processing");
  assert.equal(inspected.syncCheckpoint?.processedCount, 2);
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 1);

  await fixture.management.update("tenant-a", fixture.integrationId, {
    syntheticPropertyId: "mock-property-001",
    mockFailureScenario: "none",
  });
  inspected = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(inspected.syncCheckpoint?.status, "failed");
  assert.equal(inspected.syncCheckpoint?.lastErrorCode, "partial_processing");
  assert.equal(inspected.syncCheckpoint?.processedCount, 2);
  await fixture.management.verify("tenant-a", fixture.integrationId);
  const recovered = await sync.synchronize("tenant-a", fixture.integrationId);
  assert.equal(recovered.checkpoint.status, "succeeded");
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 3);
});

test("simulated provider timeout is explicit and does not create reservation records", async () => {
  const fixture = await createFixture("timeout");
  const sync = new STAAHMockSynchronizationService(fixture.db as unknown as D1Database, fixture.management);
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
    error instanceof STAAHSyncError && error.status === 503,
  );
  const inspected = await fixture.management.inspect("tenant-a", fixture.integrationId);
  assert.equal(inspected.syncCheckpoint?.status, "failed");
  assert.equal(inspected.syncCheckpoint?.lastErrorCode, "timeout");
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 0);
});

test("sync failure responses and logs contain only safe failure metadata", async () => {
  const fixture = await createFixture("provider_unavailable");
  const errorEntries: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { errorEntries.push(values); };
  let response: Response;
  try {
    response = await fixture.app.request(`/channel-manager/staah/${fixture.integrationId}/sync`, {
      method: "POST", headers: fixture.headers,
    }, fixture.bindings);
  } finally {
    console.error = originalError;
  }
  const responseText = await response!.text();
  assert.equal(response!.status, 503);
  assert.equal(responseText.includes("Alex Mock"), false);
  assert.equal(responseText.includes("Jamie Sample"), false);
  assert.equal(JSON.stringify(errorEntries).includes("Alex Mock"), false);
  assert.equal(JSON.stringify(errorEntries).includes("Jamie Sample"), false);
  assert.equal(errorEntries.length, 0);
});

test("normalization rejects cross-property mappings and invalid reservations", async () => {
  const context = { tenantId: "tenant-a", integrationId: "integration-a", connectionId: "integration-a" };
  const adapter = resolveSTAAHAdapter(context);
  const property = await adapter.getProperty(context, "mock-property-001");
  const mappings = buildDefaultSTAAHResourceMappings(context, property);
  const batch = await adapter.getReservations(context, property.providerPropertyId);
  const valid = batch.reservations[0];
  assert.ok(valid);
  assert.equal(normalizeSTAAHReservation(context, property, mappings, valid).hotelId, "mock-canonical-property:mock-property-001");
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings.filter((mapping) => mapping.providerPropertyId !== "mock-property-other"),
    { ...valid, providerPropertyId: "mock-property-other" },
  ));
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings.filter((mapping) => mapping.resourceType !== "room"),
    valid,
  ));
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings.filter((mapping) => mapping.resourceType !== "rate_plan"),
    valid,
  ));
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings.map((mapping) => ({ ...mapping, integrationId: "integration-b" })),
    valid,
  ));
  const invalid = batch.reservations.find((reservation) => reservation.providerReservationId === "mock-res-invalid");
  assert.ok(invalid);
  assert.throws(() => normalizeSTAAHReservation(context, property, mappings, invalid));
  for (const revision of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeSTAAHReservation(context, property, mappings, { ...valid, revision }));
  }
  const missingRevision: Record<string, unknown> = { ...valid };
  delete missingRevision.revision;
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings,
    missingRevision as unknown as typeof valid,
  ));
  assert.throws(() => normalizeSTAAHReservation(
    context,
    property,
    mappings.map((mapping) => ({ ...mapping, tenantId: "tenant-b" })),
    valid,
  ));
});

test("concurrent/replayed synchronization remains idempotent and has no external calls", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network is disabled in this test.");
  }) as typeof fetch;
  try {
    const { db, management, integrationId } = await createFixture();
    const sync = new STAAHMockSynchronizationService(db as unknown as D1Database, management);
    const results = await Promise.allSettled([
      sync.synchronize("tenant-a", integrationId),
      sync.synchronize("tenant-a", integrationId),
    ]);
    assert.equal(results.some((result) => result.status === "fulfilled"), true);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 3);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an active durable sync lease rejects a second operator invocation", async () => {
  const fixture = await createFixture();
  const current = await fixture.management.loadOperationalConnection("tenant-a", fixture.integrationId);
  const active: STAAHSyncCheckpoint = {
    ...current.syncCheckpoint,
    status: "running",
    attemptId: "synthetic-active-run",
    startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(await fixture.management.updateSyncState(
    "tenant-a", fixture.integrationId, current.record.settings, active,
  ), true);
  await assert.rejects(fixture.management.update("tenant-a", fixture.integrationId, {
    syntheticPropertyId: "mock-property-other",
  }), (error: unknown) => error instanceof STAAHManagementError && error.status === 409);
  const sync = new STAAHMockSynchronizationService(fixture.db as unknown as D1Database, fixture.management);
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
    error instanceof STAAHSyncError && error.status === 409 && error.code === "sync_already_running",
  );
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 0);
});

test("expired lease is recoverable through the existing manual sync operation", async () => {
  const fixture = await createFixture();
  const current = await fixture.management.loadOperationalConnection("tenant-a", fixture.integrationId);
  const expired: STAAHSyncCheckpoint = {
    ...current.syncCheckpoint,
    status: "running",
    attemptId: "synthetic-expired-run",
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  assert.equal(await fixture.management.updateSyncState(
    "tenant-a", fixture.integrationId, current.record.settings, expired,
  ), true);
  const recovered = await new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
  ).synchronize("tenant-a", fixture.integrationId);
  assert.equal(recovered.checkpoint.status, "succeeded");
  assert.equal(recovered.checkpoint.processedCount, 8);
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE provider = 'staah'").get()?.count, 3);
});

test("persistence failures are sanitized, checkpointed, and do not leak repository errors", async () => {
  const fixture = await createFixture();
  class FailingReservationRepository extends ReservationRecordRepository {
    override async persistProviderReservation(
      _record: ReservationRecord & { providerConnectionId: string; providerPropertyId: string },
    ): Promise<"inserted" | "updated" | "unchanged" | "stale" | "conflict"> {
      throw new Error("private-payload-must-not-escape");
    }
  }
  const sync = new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
    new FailingReservationRepository(fixture.db as unknown as D1Database),
  );
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
    error instanceof STAAHSyncError && error.code === "persistence_failure" &&
      !error.message.includes("private-payload-must-not-escape"),
  );
  const checkpoint = (await fixture.management.inspect("tenant-a", fixture.integrationId)).syncDiagnostics;
  assert.equal(checkpoint.state, "failed");
  assert.equal(checkpoint.inProgress, false);
  assert.equal(checkpoint.lastErrorCode, "persistence_failure");
});

test("mapping diagnostics identify unpersisted, valid, missing, and conflicting mappings without writing", async () => {
  const fixture = await createFixture();
  const sync = new STAAHMockSynchronizationService(fixture.db as unknown as D1Database, fixture.management);
  const initial = await sync.property("tenant-a", fixture.integrationId);
  assert.equal(initial.mappingDiagnostics.status, "not_persisted");
  assert.equal(initial.mappingDiagnostics.missingCount, 5);
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records").get()?.count, 0);

  await sync.synchronize("tenant-a", fixture.integrationId);
  const valid = await sync.property("tenant-a", fixture.integrationId);
  assert.equal(valid.mappingDiagnostics.status, "valid");
  assert.equal(valid.mappingDiagnostics.persistedCount, 5);

  const record = fixture.db.sqlite.prepare("SELECT settings FROM integrations WHERE id = ?")
    .get(fixture.integrationId) as { settings: string };
  const settings = JSON.parse(record.settings) as { resourceMappings: Array<Record<string, unknown>> };
  settings.resourceMappings = settings.resourceMappings.slice(0, 4);
  fixture.db.sqlite.prepare("UPDATE integrations SET settings = ? WHERE tenant_id = ? AND id = ?")
    .run(JSON.stringify(settings), "tenant-a", fixture.integrationId);
  const missing = await sync.property("tenant-a", fixture.integrationId);
  assert.equal(missing.mappingDiagnostics.status, "missing");
  assert.equal(missing.mappingDiagnostics.missingCount, 1);

  settings.resourceMappings = settings.resourceMappings.map((mapping, index) => index === 0
    ? { ...mapping, providerResourceId: "mock-conflicting-resource" }
    : mapping);
  fixture.db.sqlite.prepare("UPDATE integrations SET settings = ? WHERE tenant_id = ? AND id = ?")
    .run(JSON.stringify(settings), "tenant-a", fixture.integrationId);
  const conflicting = await sync.property("tenant-a", fixture.integrationId);
  assert.equal(conflicting.mappingDiagnostics.status, "conflicting");
  assert.equal(conflicting.mappingDiagnostics.conflictingCount, 1);
  await assert.rejects(sync.synchronize("tenant-a", fixture.integrationId), (error: unknown) =>
    error instanceof STAAHSyncError && error.code === "mapping_invalid",
  );
});

test("mock property identity always comes from the persisted connection, not request input", async () => {
  const fixture = await createFixture();
  const property = await new STAAHMockSynchronizationService(
    fixture.db as unknown as D1Database,
    fixture.management,
  ).property("tenant-a", fixture.integrationId);
  assert.equal(property.property.providerPropertyId, "mock-property-001");
});

test("full authorized HTTP workflow provisions, diagnoses, syncs, recovers, disables, and re-enables independently by tenant", async () => {
  const fixture = await createUnconfiguredRouteFixture();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network access is disabled in the M5 mock acceptance test.");
  }) as typeof fetch;
  try {
    const createResponse = await fixture.app.request("/channel-manager/staah", {
      method: "POST",
      headers: fixture.headersA,
      body: JSON.stringify({ syntheticPropertyId: "mock-acceptance-property" }),
    }, fixture.bindings);
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      created: boolean;
      connection: { integrationId: string; status: string; connectionHealth: { mode: string; liveStatus: string } };
    };
    assert.equal(created.created, true);
    assert.equal(created.connection.status, "configured_not_verified");
    assert.equal(created.connection.connectionHealth.mode, "mock");
    assert.equal(created.connection.connectionHealth.liveStatus, "live_not_configured");
    const integrationId = created.connection.integrationId;

    const persisted = await fixture.app.request(`/channel-manager/staah/${integrationId}`, {
      headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(persisted.status, 200);
    const persistedBody = await persisted.json() as { connection: { syntheticPropertyId: string; status: string } };
    assert.equal(persistedBody.connection.syntheticPropertyId, "mock-acceptance-property");
    assert.equal(persistedBody.connection.status, "configured_not_verified");

    const verify = () => fixture.app.request(`/channel-manager/staah/${integrationId}/verify`, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    const verified = await verify();
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json() as { connection: { status: string; connectionHealth: { verification: { result: string } } } };
    assert.equal(verifiedBody.connection.status, "mock_verified");
    assert.equal(verifiedBody.connection.connectionHealth.verification.result, "mock_verified");

    const property = await fixture.app.request(`/channel-manager/staah/${integrationId}/property`, {
      headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(property.status, 200);
    const propertyBody = await property.json() as {
      property: { providerPropertyId: string; rooms: unknown[]; ratePlans: unknown[] };
      mappingDiagnostics: { status: string; expectedCount: number };
    };
    assert.equal(propertyBody.property.providerPropertyId, "mock-acceptance-property");
    assert.equal(propertyBody.property.rooms.length, 2);
    assert.equal(propertyBody.property.ratePlans.length, 2);
    assert.equal(propertyBody.mappingDiagnostics.status, "not_persisted");
    assert.equal(propertyBody.mappingDiagnostics.expectedCount, 5);

    const syncPath = `/channel-manager/staah/${integrationId}/sync`;
    const firstSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(firstSync.status, 200);
    const firstBody = await firstSync.json() as { sync: { checkpoint: { status: string }; counts: { insertedCount: number; updatedCount: number; rejectedCount: number } } };
    assert.equal(firstBody.sync.checkpoint.status, "succeeded");
    assert.deepEqual(firstBody.sync.counts, {
      processedCount: 8,
      insertedCount: 3,
      updatedCount: 2,
      unchangedCount: 1,
      rejectedCount: 2,
    });
    const records = fixture.db.sqlite.prepare(`SELECT provider_reservation_id, revision, lifecycle, payload
      FROM reservation_records WHERE tenant_id = ? AND provider = ? ORDER BY provider_reservation_id`)
      .all("tenant-a", "staah") as Array<{ provider_reservation_id: string; revision: number; lifecycle: string; payload: string }>;
    assert.equal(records.length, 3);
    assert.equal(records.find((record) => record.provider_reservation_id === "mock-res-001")?.revision, 2);
    assert.equal(records.find((record) => record.provider_reservation_id === "mock-res-001")?.payload.includes("2030-04-11"), true);
    assert.equal(records.find((record) => record.provider_reservation_id === "mock-res-002")?.lifecycle, "cancelled");
    const firstPropertyCheck = await fixture.app.request(`/channel-manager/staah/${integrationId}/property`, {
      headers: fixture.headersA,
    }, fixture.bindings);
    const firstPropertyBody = await firstPropertyCheck.json() as {
      mappings: Array<{ tenantId: string; integrationId: string; providerPropertyId: string }>;
      mappingDiagnostics: { status: string };
    };
    assert.equal(firstPropertyBody.mappingDiagnostics.status, "valid");
    assert.equal(firstPropertyBody.mappings.every((mapping) =>
      mapping.tenantId === "tenant-a" &&
      mapping.integrationId === integrationId &&
      mapping.providerPropertyId === "mock-acceptance-property"
    ), true);

    const repeatedSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(repeatedSync.status, 200);
    const repeatedBody = await repeatedSync.json() as { sync: { counts: { insertedCount: number; updatedCount: number; unchangedCount: number } } };
    assert.equal(repeatedBody.sync.counts.insertedCount, 0);
    assert.equal(repeatedBody.sync.counts.updatedCount, 0);
    assert.equal(repeatedBody.sync.counts.unchangedCount, 3);

    const inspect = () => fixture.app.request(`/channel-manager/staah/${integrationId}`, {
      headers: fixture.headersA,
    }, fixture.bindings);
    const successDiagnostics = await inspect();
    const successBody = await successDiagnostics.json() as {
      connection: { connectionHealth: { state: string }; syncDiagnostics: { state: string; lastSuccessfulSyncAt: string | null; counts: { unchangedCount: number } } };
    };
    assert.equal(successBody.connection.connectionHealth.state, "mock_verified");
    assert.equal(successBody.connection.syncDiagnostics.state, "succeeded");
    assert.ok(successBody.connection.syncDiagnostics.lastSuccessfulSyncAt);
    assert.equal(successBody.connection.syncDiagnostics.counts.unchangedCount, 3);

    const setFailure = await fixture.app.request(`/channel-manager/staah/${integrationId}`, {
      method: "PUT", headers: fixture.headersA,
      body: JSON.stringify({ syntheticPropertyId: "mock-acceptance-property", mockFailureScenario: "provider_unavailable" }),
    }, fixture.bindings);
    assert.equal(setFailure.status, 200);
    const preserved = await inspect();
    const preservedBody = await preserved.json() as { connection: { syncDiagnostics: { state: string } } };
    assert.equal(preservedBody.connection.syncDiagnostics.state, "succeeded");
    assert.equal((await verify()).status, 200);
    const failedSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(failedSync.status, 503);
    const failureBody = await failedSync.json() as { code: string };
    assert.equal(failureBody.code, "provider_unavailable");
    const failedDiagnosticsResponse = await inspect();
    const failedDiagnostics = await failedDiagnosticsResponse.json() as {
      connection: { connectionHealth: { state: string }; syncDiagnostics: { state: string; lastErrorCode: string; inProgress: boolean } };
    };
    assert.equal(failedDiagnostics.connection.connectionHealth.state, "mock_verified");
    assert.equal(failedDiagnostics.connection.syncDiagnostics.state, "failed");
    assert.equal(failedDiagnostics.connection.syncDiagnostics.lastErrorCode, "provider_unavailable");
    assert.equal(failedDiagnostics.connection.syncDiagnostics.inProgress, false);

    const clearFailure = await fixture.app.request(`/channel-manager/staah/${integrationId}`, {
      method: "PUT", headers: fixture.headersA,
      body: JSON.stringify({ syntheticPropertyId: "mock-acceptance-property", mockFailureScenario: "none" }),
    }, fixture.bindings);
    assert.equal(clearFailure.status, 200);
    const retainedFailure = await inspect();
    assert.equal(((await retainedFailure.json()) as { connection: { syncDiagnostics: { lastErrorCode: string } } }).connection.syncDiagnostics.lastErrorCode, "provider_unavailable");
    assert.equal((await verify()).status, 200);
    const recoveredSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(recoveredSync.status, 200);

    const disabled = await fixture.app.request(`/channel-manager/staah/${integrationId}/disable`, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(disabled.status, 200);
    const disabledSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(disabledSync.status, 409);
    assert.equal((await disabledSync.json() as { code: string }).code, "connection_disabled");

    const enabled = await fixture.app.request(`/channel-manager/staah/${integrationId}/enable`, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(enabled.status, 200);
    const unverifiedSync = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(unverifiedSync.status, 409);
    assert.equal((await unverifiedSync.json() as { code: string }).code, "connection_unverified");
    assert.equal((await verify()).status, 200);
    const afterReenable = await fixture.app.request(syncPath, {
      method: "POST", headers: fixture.headersA,
    }, fixture.bindings);
    assert.equal(afterReenable.status, 200);

    const foreignInspect = await fixture.app.request(`/channel-manager/staah/${integrationId}?tenantId=tenant-a`, {
      headers: fixture.headersB,
    }, fixture.bindings);
    assert.equal(foreignInspect.status, 404);
    const foreignBody = await foreignInspect.json();
    const foreignOperations = [
      fixture.app.request(`/channel-manager/staah/${integrationId}/property`, {
        headers: fixture.headersB,
      }, fixture.bindings),
      fixture.app.request(`/channel-manager/staah/${integrationId}`, {
        method: "PUT", headers: fixture.headersB,
        body: JSON.stringify({ syntheticPropertyId: "mock-tenant-b-property" }),
      }, fixture.bindings),
      ...(["verify", "disable", "enable"] as const).map((operation) =>
        fixture.app.request(`/channel-manager/staah/${integrationId}/${operation}`, {
          method: "POST", headers: fixture.headersB,
        }, fixture.bindings)),
      fixture.app.request(`/channel-manager/staah/${integrationId}/sync`, {
        method: "POST", headers: fixture.headersB,
      }, fixture.bindings),
    ];
    for (const responsePromise of foreignOperations) {
      const response = await responsePromise;
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), foreignBody);
    }
    const tenantAAfterForeignAttempts = await inspect();
    const tenantAState = await tenantAAfterForeignAttempts.json() as {
      connection: { syntheticPropertyId: string; status: string; syncDiagnostics: { state: string } };
    };
    assert.equal(tenantAState.connection.syntheticPropertyId, "mock-acceptance-property");
    assert.equal(tenantAState.connection.status, "mock_verified");
    assert.equal(tenantAState.connection.syncDiagnostics.state, "succeeded");

    const secondCreate = await fixture.app.request("/channel-manager/staah", {
      method: "POST", headers: fixture.headersB,
      body: JSON.stringify({ syntheticPropertyId: "mock-tenant-b-property" }),
    }, fixture.bindings);
    assert.equal(secondCreate.status, 200);
    const secondBody = await secondCreate.json() as { connection: { integrationId: string } };
    assert.notEqual(secondBody.connection.integrationId, integrationId);

    const tenantBVerify = await fixture.app.request(`/channel-manager/staah/${secondBody.connection.integrationId}/verify`, {
      method: "POST", headers: fixture.headersB,
    }, fixture.bindings);
    assert.equal(tenantBVerify.status, 200);
    const tenantBProperty = await fixture.app.request(`/channel-manager/staah/${secondBody.connection.integrationId}/property`, {
      headers: fixture.headersB,
    }, fixture.bindings);
    assert.equal(tenantBProperty.status, 200);
    const tenantBPropertyBody = await tenantBProperty.json() as {
      property: { providerPropertyId: string };
      mappings: Array<{ tenantId: string; integrationId: string; providerPropertyId: string }>;
    };
    assert.equal(tenantBPropertyBody.property.providerPropertyId, "mock-tenant-b-property");
    assert.equal(tenantBPropertyBody.mappings.every((mapping) =>
      mapping.tenantId === "tenant-b" &&
      mapping.integrationId === secondBody.connection.integrationId &&
      mapping.providerPropertyId === "mock-tenant-b-property"
    ), true);
    const tenantBSync = await fixture.app.request(`/channel-manager/staah/${secondBody.connection.integrationId}/sync`, {
      method: "POST", headers: fixture.headersB,
    }, fixture.bindings);
    assert.equal(tenantBSync.status, 200);
    const tenantBSyncBody = await tenantBSync.json() as {
      sync: { integrationId: string; propertyId: string; counts: { insertedCount: number } };
    };
    assert.equal(tenantBSyncBody.sync.integrationId, secondBody.connection.integrationId);
    assert.equal(tenantBSyncBody.sync.propertyId, "mock-tenant-b-property");
    assert.equal(tenantBSyncBody.sync.counts.insertedCount, 3);

    const tenantScopedRows = fixture.db.sqlite.prepare(`SELECT tenant_id, provider_reservation_id,
      provider_connection_id, provider_property_id, canonical_reservation_id
      FROM reservation_records WHERE provider = 'staah' AND provider_reservation_id = 'mock-res-001'
      ORDER BY tenant_id`).all() as Array<{
        tenant_id: string;
        provider_reservation_id: string;
        provider_connection_id: string;
        provider_property_id: string;
        canonical_reservation_id: string;
      }>;
    assert.equal(tenantScopedRows.length, 2);
    assert.deepEqual(tenantScopedRows.map((row) => [
      row.tenant_id, row.provider_connection_id, row.provider_property_id,
    ]), [
      ["tenant-a", integrationId, "mock-acceptance-property"],
      ["tenant-b", secondBody.connection.integrationId, "mock-tenant-b-property"],
    ]);
    assert.notEqual(tenantScopedRows[0]?.canonical_reservation_id, tenantScopedRows[1]?.canonical_reservation_id);
    const tenantBInspection = await fixture.app.request(`/channel-manager/staah/${secondBody.connection.integrationId}`, {
      headers: fixture.headersB,
    }, fixture.bindings);
    const tenantBInspectionBody = await tenantBInspection.json() as {
      connection: { integrationId: string; syncDiagnostics: { state: string; counts: { insertedCount: number } } };
    };
    assert.equal(tenantBInspectionBody.connection.integrationId, secondBody.connection.integrationId);
    assert.equal(tenantBInspectionBody.connection.syncDiagnostics.state, "succeeded");
    assert.equal(tenantBInspectionBody.connection.syncDiagnostics.counts.insertedCount, 3);
    assert.equal(fetchCalls, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_credentials WHERE provider = 'staah'").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_outbound_deliveries").get()?.count, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reservation_records WHERE tenant_id = ? AND provider = ?").get("tenant-b", "staah")?.count, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test(
  "M6.1C-C local HTTP composition delivers STAAH reservations to mock GHL",
  async () => {
    const fixture = await bridgeFixture();

    const local = createLocalSTAAHMockWorker({
      db: fixture.db as unknown as D1Database,
      tenantId: "tenant-a",
      locationId: "mock-ghl-location",
      reservationFieldId: "mock-reservation-field",
      createDestinationContext: () => fixture.context,
    });

    const env = {
      ...fixture.bindings,
      APP_ENVIRONMENT: "development",
      GHL_INBOUND_QUEUE: local.queue,
      JWT_SECRET: "synthetic-local-test-secret",
      JWT_ISSUER: "synthetic-local-test",
      JWT_AUDIENCE: "synthetic-local-test",
    } as AppBindings;

    const execution = {
      waitUntil(_task: Promise<unknown>) {},
    } as unknown as ExecutionContext;

    const url =
      `http://localhost/channel-manager/staah/${fixture.integrationId}/sync`;

  type WorkerRequest = Parameters<
  NonNullable<typeof local.worker.fetch>
>[0];

const createRequest = (): WorkerRequest =>
  new Request(url, {
    method: "POST",
    headers: fixture.headers,
  }) as unknown as WorkerRequest;

    const originalFetch = globalThis.fetch;
    let externalCalls = 0;

    globalThis.fetch = (async () => {
      externalCalls++;
      throw new Error("External network access prohibited");
    }) as typeof fetch;

    try {
      // Production mode must reject the local composition.
      const denied = await local.worker.fetch!(
        createRequest(),
        {
          ...env,
          APP_ENVIRONMENT: "production",
        },
        execution,
      );

      assert.equal(denied.status, 403);
      assert.equal(eventCount(fixture.db), 0);

      // Staging must not activate the local mock runtime.
const stagingDenied = await local.worker.fetch!(
  createRequest(),
  { ...env, APP_ENVIRONMENT: "staging" },
  execution,
);

assert.equal(stagingDenied.status, 403);

// A missing or mismatched Queue binding must fail closed.
const missingQueueDenied = await local.worker.fetch!(
  createRequest(),
  { ...env, GHL_INBOUND_QUEUE: undefined },
  execution,
);

assert.equal(missingQueueDenied.status, 403);

// A different database binding must fail closed.
const wrongDatabaseDenied = await local.worker.fetch!(
  createRequest(),
  { ...env, DB: {} as D1Database },
  execution,
);

assert.equal(wrongDatabaseDenied.status, 403);

// Rejected requests must not produce reservation events.
assert.equal(eventCount(fixture.db), 0);
assert.equal(local.pendingEnvelopes.length, 0);

      // The authorized development request must use the
      // explicitly injected STAAH mock synchronization service.
      const response = await local.worker.fetch!(
        createRequest(),
        env,
        execution,
      );

      assert.equal(
        response.status,
        200,
        await response.clone().text(),
      );

      const body = await response.json() as {
        success: boolean;
        sync: {
          checkpoint: { status: string };
          counts: {
            insertedCount: number;
            updatedCount: number;
          };
        };
      };

      assert.equal(body.success, true);
      assert.equal(body.sync.checkpoint.status, "succeeded");
      assert.equal(body.sync.counts.insertedCount, 3);
      assert.equal(body.sync.counts.updatedCount, 2);

      // Five durable reservation events should be created.
      assert.equal(eventCount(fixture.db), 5);
      assert.equal(local.pendingEnvelopes.length, 5);

      // Manually deliver the in-memory Queue messages.
      // No real Cloudflare Queue or GHL API is involved.
      for (const envelope of [...local.pendingEnvelopes]) {
        let outcome = "";

        const batch = {
          messages: [
            {
              body: envelope,
              id: "synthetic-local-queue",
              timestamp: new Date(),
              attempts: 1,

              ack() {
                outcome = "acked";
              },

              retry() {
                outcome = "retry";
              },
            },
          ],
        } as unknown as MessageBatch<GHLInboundQueueEnvelope>;

        await local.worker.queue!(
          batch,
          env,
          execution,
        );

        assert.equal(outcome, "acked");
      }

      // Three reservations should become three contacts
      // and three opportunities in synthetic GHL.
      assert.deepEqual(local.mock.snapshot(), {
        contactCount: 3,
        opportunityCount: 3,
      });

      assert.equal(
        fixture.db.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM integration_events WHERE processing_status='processed'",
          )
          .get()?.count,
        5,
      );

      // Replaying HTTP synchronization is idempotent.
      const replay = await local.worker.fetch!(
        createRequest(),
        env,
        execution,
      );

      assert.equal(replay.status, 200);
      assert.equal(eventCount(fixture.db), 5);
      assert.equal(local.pendingEnvelopes.length, 5);

      // No external network request is permitted.
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "M6.2D mock ARI is tenant-scoped read-only and fail-closed",
  async () => {
    const fixture = await createFixture();

    const originalFetch = globalThis.fetch;
    let externalCalls = 0;

    globalThis.fetch = (async () => {
      externalCalls++;
      throw new Error("External network prohibited in ARI test.");
    }) as typeof fetch;

    try {
      const path =
        `/channel-manager/staah/${fixture.integrationId}/ari`;

      const validQuery =
        `${path}?startDate=2030-04-10&endDate=2030-04-16`;

      // -------------------------------------------
      // 1. Authorized synthetic ARI retrieval
      // -------------------------------------------

      const response = await fixture.app.request(
        validQuery,
        { headers: fixture.headers },
        fixture.bindings,
      );

      assert.equal(
        response.status,
        200,
        await response.clone().text(),
      );

      const body = await response.json() as {
        success: boolean;
        provider: string;
        mode: string;
        tenantId: string;
        integrationId: string;
        ari: {
          providerPropertyId: string;
          startDate: string;
          endDate: string;
          mode: string;
          records: Array<{
            date: string;
            providerPropertyId: string;
            providerRoomId: string;
            providerRatePlanId: string;
            currency: string;
            totalRooms: number;
            availableRooms: number;
            rateAmountMinor: number;
            sellable: boolean;
          }>;
        };
      };

      assert.equal(body.success, true);
      assert.equal(body.provider, "staah");
      assert.equal(body.mode, "mock");
      assert.equal(body.tenantId, "tenant-a");
      assert.equal(body.integrationId, fixture.integrationId);
      assert.equal(
        body.ari.providerPropertyId,
        "mock-property-001",
      );

      // 7 dates x 2 rooms x 2 rate plans = 28.
      assert.equal(body.ari.records.length, 28);

      const uniqueRecords = new Set<string>();

      for (const record of body.ari.records) {
        assert.equal(record.currency, "USD");
        assert.equal(
          record.providerPropertyId,
          "mock-property-001",
        );

        assert.ok(record.date >= "2030-04-10");
        assert.ok(record.date <= "2030-04-16");

        assert.ok(record.totalRooms >= 0);
        assert.ok(record.availableRooms >= 0);
        assert.ok(
          record.availableRooms <= record.totalRooms,
        );

        assert.ok(
          Number.isSafeInteger(record.rateAmountMinor),
        );

        assert.ok(record.rateAmountMinor >= 0);

        assert.equal(
          record.sellable,
          record.availableRooms > 0,
        );

        const key = [
          record.date,
          record.providerRoomId,
          record.providerRatePlanId,
        ].join("|");

        assert.equal(uniqueRecords.has(key), false);
        uniqueRecords.add(key);
      }

      // -------------------------------------------
      // 2. Deterministic replay
      // -------------------------------------------

      const replay = await fixture.app.request(
        validQuery,
        { headers: fixture.headers },
        fixture.bindings,
      );

      assert.equal(replay.status, 200);

      const replayBody = await replay.json() as typeof body;

      assert.deepEqual(
        replayBody.ari.records,
        body.ari.records,
      );

      // -------------------------------------------
      // 3. Invalid date ranges
      // -------------------------------------------

      const invalidQueries = [
        `${path}?startDate=2030-02-30&endDate=2030-03-02`,
        `${path}?startDate=2030-04-16&endDate=2030-04-10`,
        `${path}?startDate=2030-04-01&endDate=2030-05-02`,
        `${path}?startDate=invalid&endDate=2030-04-10`,
        path,
      ];

      for (const query of invalidQueries) {
        const invalid = await fixture.app.request(
          query,
          { headers: fixture.headers },
          fixture.bindings,
        );

        assert.equal(invalid.status, 400);

        const error = await invalid.json() as {
          success: boolean;
          code: string;
        };

        assert.equal(error.success, false);
        assert.equal(error.code, "invalid_date_range");
      }

      // -------------------------------------------
      // 4. Cross-tenant access must be rejected
      // -------------------------------------------

      const isolation = await createUnconfiguredRouteFixture();

      const management = new STAAHConnectionManagementService(
        isolation.db as unknown as D1Database,
      );

      const configured = await management.configure(
        "tenant-a",
        {
          syntheticPropertyId: "mock-property-001",
        },
      );

      const foreignIntegrationId =
        configured.connection.integrationId;

      assert.ok(foreignIntegrationId);

      await management.verify(
        "tenant-a",
        foreignIntegrationId,
      );

      const foreignPath =
        `/channel-manager/staah/${foreignIntegrationId}/ari` +
        `?startDate=2030-04-10&endDate=2030-04-16`;

      const foreignResponse = await isolation.app.request(
        foreignPath,
        {
          headers: isolation.headersB,
        },
        isolation.bindings,
      );

      assert.equal(foreignResponse.status, 404);

      // Confirm the rightful tenant can access it.
      const ownerResponse = await isolation.app.request(
        foreignPath,
        {
          headers: isolation.headersA,
        },
        isolation.bindings,
      );

      assert.equal(ownerResponse.status, 200);

      // -------------------------------------------
      // 5. Disabled connection must be rejected
      // -------------------------------------------

      await fixture.management.disable(
        "tenant-a",
        fixture.integrationId,
      );

      const disabled = await fixture.app.request(
        validQuery,
        { headers: fixture.headers },
        fixture.bindings,
      );

      assert.equal(disabled.status, 409);

      const disabledBody = await disabled.json() as {
        code: string;
      };

      assert.equal(
        disabledBody.code,
        "connection_disabled",
      );

      // -------------------------------------------
      // 6. Unverified connection must be rejected
      // -------------------------------------------

      await fixture.management.enable(
        "tenant-a",
        fixture.integrationId,
      );

      const unverified = await fixture.app.request(
        validQuery,
        { headers: fixture.headers },
        fixture.bindings,
      );

      assert.equal(unverified.status, 409);

      const unverifiedBody = await unverified.json() as {
        code: string;
      };

      assert.equal(
        unverifiedBody.code,
        "connection_unverified",
      );

      // -------------------------------------------
      // 7. ARI must be read-only
      // -------------------------------------------

      assert.equal(
        fixture.db.sqlite.prepare(
          "SELECT COUNT(*) AS count FROM reservation_records",
        ).get()?.count,
        0,
      );

      assert.equal(eventCount(fixture.db), 0);

      assert.equal(
        isolation.db.sqlite.prepare(
          "SELECT COUNT(*) AS count FROM reservation_records",
        ).get()?.count,
        0,
      );

      assert.equal(eventCount(isolation.db), 0);

      // No real provider requests.
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "M6.3D local mock booking submission is durable and isolated",
  async () => {
    const fixture = await createFixture();

    // Separate databases with separate schemas.
    const mockDb = new SQLiteD1("mock-booking");

    const local = createLocalSTAAHMockWorker({
      db: fixture.db as unknown as D1Database,
      mockBookingDb: mockDb as unknown as D1Database,
      tenantId: "tenant-a",
      locationId: "mock-ghl-location",
      reservationFieldId: "mock-reservation-field",

      // Booking submission must never invoke GHL.
      createDestinationContext: async () => {
        throw new Error(
          "Mock booking must not create CRM context.",
        );
      },
    });

    const env = {
      ...fixture.bindings,
      APP_ENVIRONMENT: "development",
      GHL_INBOUND_QUEUE: local.queue,
      JWT_SECRET: "synthetic-local-test-secret",
      JWT_ISSUER: "synthetic-local-test",
      JWT_AUDIENCE: "synthetic-local-test",
    } as AppBindings;

    const execution = {
      waitUntil(_task: Promise<unknown>) {},
    } as unknown as ExecutionContext;

    type WorkerRequest = Parameters<
      NonNullable<typeof local.worker.fetch>
    >[0];

    const url =
      `http://localhost/channel-manager/staah/` +
      `${fixture.integrationId}/mock-booking`;

    const post = (
      body: unknown,
      bindings: AppBindings = env,
      headers: Record<string, string> = fixture.headers,
    ) =>
      local.worker.fetch!(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }) as unknown as WorkerRequest,
        bindings,
        execution,
      );

    const originalFetch = globalThis.fetch;
    let externalCalls = 0;

    globalThis.fetch = (async () => {
      externalCalls++;
      throw new Error(
        "External network prohibited in mock booking test.",
      );
    }) as typeof fetch;

    try {
      // Find a suitable day from the existing synthetic ARI.
      const ariResponse = await fixture.app.request(
        `/channel-manager/staah/${fixture.integrationId}/ari` +
          "?startDate=2030-04-10&endDate=2030-04-16",
        { headers: fixture.headers },
        fixture.bindings,
      );

      assert.equal(ariResponse.status, 200);

      const ariBody = await ariResponse.json() as {
        ari: {
          records: Array<{
            date: string;
            providerRoomId: string;
            providerRatePlanId: string;
            availableRooms: number;
            rateAmountMinor: number;
          }>;
        };
      };

      const available = ariBody.ari.records.find(
        (record) =>
          record.providerRoomId === "mock-room-001" &&
          record.providerRatePlanId === "mock-rate-001" &&
          record.availableRooms > 0 &&
          record.availableRooms < 8,
      );

      assert.ok(available);

      const checkout = new Date(
        `${available.date}T00:00:00.000Z`,
      );

      checkout.setUTCDate(
        checkout.getUTCDate() + 1,
      );

      const booking = {
        idempotencyKey: "local-mock-booking-0001",
        providerRoomId: "mock-room-001",
        providerRatePlanId: "mock-rate-001",
        checkIn: available.date,
        checkOut: checkout.toISOString().slice(0, 10),
        quantity: 1,
        adults: 2,
        guest: {
          firstName: "Alex",
          lastName: "Mock",
          email: "alex@example.invalid",
        },
      };

      // 1. First submission creates one synthetic booking.
      const first = await post(booking);

      assert.equal(
        first.status,
        200,
        await first.clone().text(),
      );

      const firstBody = await first.json() as {
        success: boolean;
        mode: string;
        replayed: boolean;
        booking: {
          bookingReference: string;
          provider: string;
          mode: string;
          status: string;
          totalAmountMinor: number;
        };
      };

      assert.equal(firstBody.success, true);
      assert.equal(firstBody.mode, "mock");
      assert.equal(firstBody.replayed, false);
      assert.equal(firstBody.booking.provider, "staah");
      assert.equal(firstBody.booking.mode, "mock");
      assert.equal(firstBody.booking.status, "simulated");
      assert.ok(
        firstBody.booking.bookingReference.startsWith(
          "mock-booking-",
        ),
      );
      assert.equal(
        firstBody.booking.totalAmountMinor,
        available.rateAmountMinor,
      );

      // 2. Identical request replays the original result.
      const replay = await post(booking);

      assert.equal(replay.status, 200);

      const replayBody =
        await replay.json() as typeof firstBody;

      assert.equal(replayBody.replayed, true);

      assert.deepEqual(
        replayBody.booking,
        firstBody.booking,
      );

      // 3. Different payload with the same key is rejected.
      const conflict = await post({
        ...booking,
        guest: {
          ...booking.guest,
          lastName: "Different",
        },
      });

      assert.equal(conflict.status, 409);

      const conflictBody = await conflict.json() as {
        code: string;
      };

      assert.equal(
        conflictBody.code,
        "idempotency_conflict",
      );

      // 4. Insufficient synthetic inventory is rejected.
      const unavailable = await post({
        ...booking,
        idempotencyKey: "local-mock-booking-0002",
        quantity: available.availableRooms + 1,
      });

      assert.equal(unavailable.status, 409);

      const unavailableBody = await unavailable.json() as {
        code: string;
      };

      assert.equal(
        unavailableBody.code,
        "inventory_unavailable",
      );

      // 5. Production and staging reject local execution.
      for (const environment of [
        "production",
        "staging",
      ]) {
        const rejected = await post(booking, {
          ...env,
          APP_ENVIRONMENT: environment,
        });

        assert.equal(rejected.status, 403);
      }

      // 6. Core and mock database bindings must differ.
      assert.throws(
        () => createLocalSTAAHMockWorker({
          db: fixture.db as unknown as D1Database,
          mockBookingDb:
            fixture.db as unknown as D1Database,
          tenantId: "tenant-a",
          locationId: "mock-ghl-location",
          reservationFieldId: "mock-reservation-field",
          createDestinationContext: async () => {
            throw new Error("No CRM access permitted.");
          },
        }),
      );

      // 7. Separate mock DB holds exactly one booking.
      const stored = mockDb.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM staah_mock_booking_submissions
      `).get() as { count: number };

      assert.equal(stored.count, 1);

      // 8. The Core database has no mock-booking table.
      const coreMockTable = fixture.db.sqlite.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'staah_mock_booking_submissions'
      `).get();

      assert.equal(coreMockTable, undefined);

      // 9. No canonical reservation or integration event.
      const reservations = fixture.db.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM reservation_records
      `).get() as { count: number };

      assert.equal(reservations.count, 0);
      assert.equal(eventCount(fixture.db), 0);

      // 10. No GHL records or external HTTP calls.
      const snapshot = local.mock.snapshot();

      assert.equal(snapshot.contactCount, 0);
      assert.equal(snapshot.opportunityCount, 0);
      assert.equal(local.pendingEnvelopes.length, 0);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

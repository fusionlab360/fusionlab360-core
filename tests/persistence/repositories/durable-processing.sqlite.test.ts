import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "@cloudflare/workers-types";
import type { IntegrationContext } from "../../../src/context/integration";
import { KnownNonDeliveryError } from "../../../src/core/messaging";
import type { MessagingProvider } from "../../../src/core/messaging";
import { IntegrationEventService } from "../../../src/core/events/service";
import { IntegrationEventProcessingError } from "../../../src/core/events/errors";
import { MessagingOutboundDeliveryRepository } from "../../../src/persistence/repositories/messaging-outbound-delivery-repository";
import { IntegrationEventRepository } from "../../../src/persistence/repositories/integration-event-repository";
import { IntegrationEventDeadLetterRepository } from "../../../src/persistence/repositories/integration-event-dead-letter-repository";
import { withDurableOutboundDelivery } from "../../../src/domain/messaging/outbound-delivery";
import { enqueuePersistedKnowledgeEvent } from "../../../src/domain/knowledge/queue-dispatch";
import type { GHLInboundQueueEnvelope } from "../../../src/domain/messaging/inbound-queue-contract";
import {
  inspectIntegrationEventReplay,
  replayDeadLetterIntegrationEvent,
} from "../../../src/core/events/replay";
import { processKnowledgeEventWithLease } from "../../../src/domain/knowledge/queue-processing";

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  failBatchAt: number | null = null;

  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      run: async () => {
        const result = this.sqlite.prepare(sql).run(...bindings as never[]);
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() =>
        this.sqlite.prepare(sql).get(...bindings as never[]) as T | undefined ?? null,
      all: async <T>() => ({
        results: this.sqlite.prepare(sql).all(...bindings as never[]) as T[],
      }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const [index, statement] of statements.entries()) {
        if (index === this.failBatchAt) {
          this.failBatchAt = null;
          throw new Error("Injected local SQLite batch failure.");
        }
        results.push(await statement.run<T>());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function applyMigrations(
  database: SqliteD1Database,
  filenames = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort(),
): void {
  for (const filename of filenames) {
    database.sqlite.exec(
      readFileSync(join(process.cwd(), "migrations", filename), "utf8"),
    );
  }
}

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  applyMigrations(database);
  return database;
}

const context = {
  tenant: { id: "sqlite-tenant" },
  provider: "gohighlevel",
} as IntegrationContext;

const reply = {
  conversationId: "conversation-1",
  contactId: "contact-1",
  text: "Reply text is stored only as a digest.",
  channel: "sms",
};

function messagingProvider(
  sendText: MessagingProvider["sendText"],
): MessagingProvider {
  return { async getRecentMessages() { return []; }, sendText };
}

function seedEvent(
  database: SqliteD1Database,
  options: { status?: string; attempts?: number; leaseToken?: string | null; expiresAt?: string | null } = {},
): void {
  database.sqlite.prepare(`
    INSERT INTO integration_events (
      event_id, tenant_id, event_type, aggregate_type, aggregate_id,
      provider, occurred_at, received_at, payload, processing_status,
      processing_attempts, processing_started_at, processing_lease_token,
      processing_lease_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-1", "tenant-1", "messaging.inbound", "conversation",
    "conversation-1", "gohighlevel", "2026-01-01", "2026-01-01", "{}",
    options.status ?? "received", options.attempts ?? 0,
    options.status === "processing" ? new Date().toISOString() : null,
    options.leaseToken ?? null,
    options.expiresAt ?? null,
  );
}

test("all migrations apply sequentially to a fresh real SQLite database", () => {
  const database = new SqliteD1Database();
  const migrations = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  applyMigrations(database, migrations);
  const columns = database.sqlite.prepare(
    "PRAGMA table_info(messaging_outbound_deliveries)",
  ).all() as Array<{ name: string }>;
  assert.deepEqual(columns.map((column) => column.name), [
    "id", "tenant_id", "event_id", "provider", "effect_key",
    "conversation_id", "payload_hash", "status", "attempt_count",
    "lease_token", "lease_expires_at", "provider_message_id",
    "provider_conversation_id", "last_error_code", "created_at", "updated_at", "connection_id", "recipient_id", "provider_delivery_status",
  ]);
  database.sqlite.close();
});

test("reservation identity migration preserves legacy rows and rejects incomplete scoped identities", () => {
  const database = new SqliteD1Database();
  const migrations = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const identityMigrationIndex = migrations.indexOf("0028_reservation_provider_connection_identity.sql");
  assert.notEqual(identityMigrationIndex, -1);
  applyMigrations(database, migrations.slice(0, identityMigrationIndex));

  const insertLegacy = database.sqlite.prepare(`
    INSERT INTO reservation_records (
      tenant_id, canonical_reservation_id, provider, provider_reservation_id,
      revision, lifecycle, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertLegacy.run("legacy-tenant", "legacy-a", "legacy-provider", "external-shared", 1, "confirmed", "{}");
  insertLegacy.run("legacy-tenant", "legacy-b", "legacy-provider", "external-shared", 1, "confirmed", "{}");

  const identityMigration = migrations[identityMigrationIndex];
  assert.ok(identityMigration);
  database.sqlite.exec(readFileSync(join(process.cwd(), "migrations", identityMigration), "utf8"));
  const legacyRows = database.sqlite.prepare(`
    SELECT provider_connection_id, provider_property_id
    FROM reservation_records WHERE tenant_id = ? ORDER BY canonical_reservation_id
  `).all("legacy-tenant") as Array<{
    provider_connection_id: string | null;
    provider_property_id: string | null;
  }>;
  assert.equal(legacyRows.length, 2);
  assert.equal(legacyRows.every((row) => row.provider_connection_id === null && row.provider_property_id === null), true);
  database.sqlite.prepare(`
    UPDATE reservation_records SET payload = ?
    WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).run("{\"legacyUpdate\":true}", "legacy-tenant", "legacy-a");
  assert.equal(database.sqlite.prepare(`
    SELECT payload FROM reservation_records WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).get("legacy-tenant", "legacy-a")?.payload, "{\"legacyUpdate\":true}");

  const insertScoped = database.sqlite.prepare(`
    INSERT INTO reservation_records (
      tenant_id, canonical_reservation_id, provider, provider_reservation_id,
      provider_connection_id, provider_property_id, revision, lifecycle, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const scoped = (
    canonicalId: string,
    connectionId: string | null,
    propertyId: string | null,
    reservationId = "scoped-shared",
    tenantId = "tenant-a",
  ) => insertScoped.run(
    tenantId, canonicalId, "staah", reservationId, connectionId, propertyId, 1, "confirmed", "{}",
  );

  scoped("full-a", "connection-a", "property-a");
  assert.throws(() => scoped("full-duplicate", "connection-a", "property-a"));
  scoped("other-property", "connection-a", "property-b");
  scoped("other-connection", "connection-b", "property-a");
  scoped("other-tenant", "connection-a", "property-a", "scoped-shared", "tenant-b");

  assert.throws(() => scoped("connection-only", "connection-a", null));
  assert.throws(() => scoped("property-only", null, "property-a"));
  assert.throws(() => scoped("empty-connection", "", "property-a"));
  assert.throws(() => scoped("whitespace-connection", "   ", "property-a"));
  assert.throws(() => scoped("empty-property", "connection-a", ""));
  assert.throws(() => scoped("whitespace-property", "connection-a", "   "));

  assert.throws(() => database.sqlite.prepare(`
    UPDATE reservation_records SET provider_property_id = NULL
    WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).run("tenant-a", "full-a"));
  assert.throws(() => database.sqlite.prepare(`
    UPDATE reservation_records SET provider_connection_id = ?
    WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).run("connection-a", "legacy-tenant", "legacy-a"));
  assert.throws(() => database.sqlite.prepare(`
    UPDATE reservation_records SET provider_property_id = ?
    WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).run("property-a", "legacy-tenant", "legacy-b"));
  assert.throws(() => database.sqlite.prepare(`
    UPDATE reservation_records SET provider_connection_id = ?
    WHERE tenant_id = ? AND canonical_reservation_id = ?
  `).run("   ", "legacy-tenant", "legacy-b"));

  database.sqlite.close();
});

test("durable-processing migration preserves an existing populated event table", () => {
  const database = new SqliteD1Database();
  const migrations = readdirSync(join(process.cwd(), "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const durableMigrationIndex = migrations.indexOf("0025_durable_inbound_processing.sql");
  applyMigrations(database, migrations.slice(0, durableMigrationIndex));
  database.sqlite.prepare(`
    INSERT INTO integration_events (
      event_id, tenant_id, event_type, aggregate_type, aggregate_id,
      provider, occurred_at, received_at, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("legacy-event", "tenant-legacy", "legacy", "test", "aggregate", "gohighlevel", "2026", "2026", "legacy-payload");
  applyMigrations(database, migrations.slice(durableMigrationIndex));

  const preserved = database.sqlite.prepare(
    "SELECT event_id, tenant_id, payload, processing_status, external_event_id FROM integration_events WHERE event_id = ?",
  ).get("legacy-event") as { event_id: string; tenant_id: string; payload: string; processing_status: string; external_event_id: string | null };
  assert.deepEqual({ ...preserved }, {
    event_id: "legacy-event",
    tenant_id: "tenant-legacy",
    payload: "legacy-payload",
    processing_status: "received",
    external_event_id: null,
  });
  database.sqlite.close();
});

test("outbound reservations validate the actual SQL, duplicate state, lease, and confirmed delivery", async () => {
  const database = createDatabase();
  const repository = new MessagingOutboundDeliveryRepository(database as unknown as D1Database);
  const input = {
    tenantId: "tenant-1", eventId: "event-1", provider: "gohighlevel",
    effectKey: "reply-0", payload: { ...reply, channel: "sms" },
  };

  const reservation = await repository.reserve(input);
  assert.equal(reservation.state, "send");
  if (reservation.state !== "send") assert.fail("Expected a send lease.");
  assert.equal((await repository.reserve(input)).state, "active");
  assert.equal(await repository.markSent({
    tenantId: "tenant-1", eventId: "event-1", effectKey: "reply-0",
    leaseToken: "stale-token", messageId: "stale-message",
    conversationId: "conversation-1",
  }), false);
  assert.equal(await repository.markSent({
    tenantId: "tenant-1", eventId: "event-1", effectKey: "reply-0",
    leaseToken: reservation.leaseToken, messageId: "provider-message-1",
    conversationId: "conversation-1",
  }), true);
  assert.deepEqual(await repository.reserve(input), {
    state: "sent", messageId: "provider-message-1", conversationId: "conversation-1",
  });
  database.sqlite.close();
});

test("known preflight failures are retryable while provider exceptions remain unknown", async () => {
  const knownDb = createDatabase();
  let knownCalls = 0;
  const knownFailure = withDurableOutboundDelivery(
    knownDb as unknown as D1Database,
    messagingProvider(async () => {
      knownCalls += 1;
      throw new KnownNonDeliveryError("Local channel validation failed.");
    }),
    "event-known",
    async () => true,
  );
  await assert.rejects(knownFailure.sendText(context, reply), KnownNonDeliveryError);
  assert.equal(knownDb.sqlite.prepare(
    "SELECT status FROM messaging_outbound_deliveries WHERE event_id = ?",
  ).get("event-known")?.status, "failed");

  const retried = withDurableOutboundDelivery(
    knownDb as unknown as D1Database,
    messagingProvider(async () => {
      knownCalls += 1;
      return { messageId: "confirmed", conversationId: "conversation-1" };
    }),
    "event-known",
    async () => true,
  );
  assert.equal((await retried.sendText(context, reply)).messageId, "confirmed");
  assert.equal(knownCalls, 2);
  knownDb.sqlite.close();

  const unknownDb = createDatabase();
  let unknownCalls = 0;
  const ambiguous = withDurableOutboundDelivery(
    unknownDb as unknown as D1Database,
    messagingProvider(async () => {
      unknownCalls += 1;
      throw new Error("Transport ended without a confirmed response.");
    }),
    "event-unknown",
    async () => true,
  );
  await assert.rejects(ambiguous.sendText(context, reply), /outcome is unknown/i);
  const state = unknownDb.sqlite.prepare(
    "SELECT status FROM messaging_outbound_deliveries WHERE event_id = ?",
  ).get("event-unknown") as { status: string };
  assert.equal(state.status, "unknown");
  assert.equal(unknownCalls, 1);
  unknownDb.sqlite.close();
});

test("permanent GHL history rejection is persisted as a non-retryable dead letter", async () => {
  const database = createDatabase();
  seedEvent(database);
  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  const service = new IntegrationEventService(repository);
  const claim = await service.claimForProcessing("tenant-1", "event-1");
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") assert.fail("Expected event processing lease.");

  await service.markFailed(
    "tenant-1",
    "event-1",
    new IntegrationEventProcessingError({
      code: "PROVIDER_REQUEST_REJECTED",
      severity: "error",
      message: "Conversation history request was rejected by the provider.",
      retryable: false,
    }),
    claim.leaseToken,
  );

  assert.equal((database.sqlite.prepare(
    "SELECT processing_status FROM integration_events WHERE event_id = ?",
  ).get("event-1") as { processing_status: string }).processing_status, "dead_letter");
  const deadLetter = database.sqlite.prepare(
    "SELECT error_code, retryable FROM integration_event_dead_letters WHERE event_id = ?",
  ).get("event-1") as { error_code: string; retryable: number };
  assert.equal(deadLetter.error_code, "PROVIDER_REQUEST_REJECTED");
  assert.equal(deadLetter.retryable, 0);
  database.sqlite.close();
});

test("terminal event and dead-letter record roll back together and retry idempotently", async () => {
  const database = createDatabase();
  seedEvent(database);
  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  const claim = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-a",
    new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(claim.state, "claimed");

  database.failBatchAt = 1;
  await assert.rejects(repository.markFailed(
    "tenant-1", "event-1", "dead_letter", "INVALID_EVENT", "Invalid event.", "lease-a",
  ));
  assert.equal((database.sqlite.prepare(
    "SELECT processing_status FROM integration_events WHERE event_id = ?",
  ).get("event-1") as { processing_status: string }).processing_status, "processing");
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters",
  ).get() as { count: number }).count, 0);

  assert.equal(await repository.markFailed(
    "tenant-1", "event-1", "dead_letter", "INVALID_EVENT", "Invalid event.", "lease-a",
  ), true);
  assert.equal(await repository.markFailed(
    "tenant-1", "event-1", "dead_letter", "INVALID_EVENT", "Invalid event.", "lease-a",
  ), false);
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters",
  ).get() as { count: number }).count, 1);
  database.sqlite.close();
});

test("a legacy terminal event missing its dead-letter row is repaired on redelivery", async () => {
  const database = createDatabase();
  seedEvent(database, { status: "dead_letter", attempts: 2 });
  database.sqlite.prepare(`
    UPDATE integration_events
    SET last_error_code = ?, last_error_message = ?
    WHERE event_id = ?
  `).run("INVALID_EVENT", "Previously terminal without a dead-letter record.", "event-1");

  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  assert.deepEqual(await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "new-lease",
    new Date(Date.now() + 120_000).toISOString(), 5,
  ), { state: "terminal" });
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters WHERE event_id = ? AND error_code = ?",
  ).get("event-1", "INVALID_EVENT") as { count: number }).count, 1);
  database.sqlite.close();
});

test("stale claim cannot dead-letter a newer lease", async () => {
  const database = createDatabase();
  seedEvent(database);
  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-old",
    new Date(Date.now() + 120_000).toISOString(), 5,
  );
  database.sqlite.prepare(
    "UPDATE integration_events SET processing_lease_expires_at = ? WHERE event_id = ?",
  ).run(new Date(Date.now() - 1_000).toISOString(), "event-1");
  const recovered = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-new",
    new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(recovered.state, "claimed");
  assert.equal(await repository.markFailed(
    "tenant-1", "event-1", "dead_letter", "INVALID_EVENT", "Old worker.", "lease-old",
  ), false);
  assert.equal((database.sqlite.prepare(
    "SELECT processing_status, processing_lease_token FROM integration_events WHERE event_id = ?",
  ).get("event-1") as { processing_status: string; processing_lease_token: string }).processing_lease_token, "lease-new");
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters",
  ).get() as { count: number }).count, 0);
  database.sqlite.close();
});

test("expired events at the claim limit are atomically dead-lettered, active claims stay active", async () => {
  const database = createDatabase();
  seedEvent(database, {
    status: "processing", attempts: 5, leaseToken: "lease-current",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  const active = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-other",
    new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(active.state, "active");

  database.sqlite.prepare(
    "UPDATE integration_events SET processing_lease_expires_at = ? WHERE event_id = ?",
  ).run(new Date(Date.now() - 1_000).toISOString(), "event-1");
  database.failBatchAt = 1;
  await assert.rejects(repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-other",
    new Date(Date.now() + 120_000).toISOString(), 5,
  ));
  assert.equal((database.sqlite.prepare(
    "SELECT processing_status FROM integration_events WHERE event_id = ?",
  ).get("event-1") as { processing_status: string }).processing_status, "processing");
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters",
  ).get() as { count: number }).count, 0);

  const exhausted = await repository.claimForProcessing(
    "tenant-1", "event-1", new Date().toISOString(),
    new Date(Date.now() - 120_000).toISOString(), "lease-other",
    new Date(Date.now() + 120_000).toISOString(), 5,
  );
  assert.equal(exhausted.state, "exhausted");
  assert.equal((database.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM integration_event_dead_letters WHERE error_code = 'ATTEMPTS_EXHAUSTED'",
  ).get() as { count: number }).count, 1);
  database.sqlite.close();
});

test("legacy event IDs and tenant-scoped createIfAbsent callers remain compatible", async () => {
  const database = createDatabase();
  database.sqlite.prepare(`
    INSERT INTO integration_events (
      event_id, tenant_id, event_type, aggregate_type, aggregate_id,
      provider, occurred_at, received_at, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("legacy-source-id", "tenant-a", "knowledge.webhook", "knowledge_document", "doc", "gohighlevel", "2026", "2026", "{}");

  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  const service = new IntegrationEventService(repository);
  const legacy = await service.accept({
    eventId: "legacy-source-id", tenantId: "tenant-a", eventType: "knowledge.webhook",
    aggregateType: "knowledge_document", aggregateId: "doc", provider: "gohighlevel",
    occurredAt: "2026", payload: {},
  });
  assert.equal(legacy.duplicate, true);
  assert.equal(legacy.event.eventId, "legacy-source-id");

  const knowledgeEvent = {
    eventId: "same-provider-webhook", eventType: "knowledge.asset", aggregateType: "knowledge_document",
    aggregateId: "doc", provider: "gohighlevel", occurredAt: "2026", receivedAt: "2026", payload: "{}",
  };
  assert.equal(await repository.createIfAbsent({ ...knowledgeEvent, tenantId: "tenant-a" }), true);
  assert.equal(await repository.createIfAbsent({ ...knowledgeEvent, tenantId: "tenant-a" }), false);
  assert.equal(await repository.createIfAbsent({ ...knowledgeEvent, tenantId: "tenant-b" }), true);
  database.sqlite.close();
});

test("persisted knowledge event dispatches by identity and completes through the event lease", async () => {
  const database = createDatabase();
  const repository = new IntegrationEventRepository(database as unknown as D1Database);
  const inserted = await repository.createIfAbsent({
    eventId: "provider-knowledge-event",
    externalEventId: "provider-knowledge-event",
    tenantId: "tenant-a",
    eventType: "KnowledgeBaseRichTextChange",
    aggregateType: "knowledge_document",
    aggregateId: "base:rich_text:document",
    provider: "gohighlevel",
    occurredAt: "2026-10-16T00:00:00.000Z",
    receivedAt: "2026-10-16T00:00:01.000Z",
    payload: JSON.stringify({ type: "KnowledgeBaseRichTextChange", locationId: "location-a" }),
  });
  assert.equal(inserted, true);

  const messages: GHLInboundQueueEnvelope[] = [];
  const queue = { async send(message: GHLInboundQueueEnvelope) { messages.push(message); } };
  assert.equal(await enqueuePersistedKnowledgeEvent(
    queue as unknown as Queue<GHLInboundQueueEnvelope>,
    repository,
    "tenant-a",
    "provider-knowledge-event",
  ), true);
  const storedEventId = await repository.findByExternalIdentity(
    "tenant-a",
    "gohighlevel",
    "provider-knowledge-event",
  );
  assert.ok(storedEventId);
  assert.deepEqual(messages, [{
    version: 1,
    kind: "knowledge",
    tenantId: "tenant-a",
    provider: "gohighlevel",
    sourceEventId: storedEventId,
  }]);
  assert.equal("payload" in messages[0], false);

  const service = new IntegrationEventService(repository);
  const queuedId = messages[0].kind === "knowledge" ? messages[0].sourceEventId : "";
  const claim = await service.claimForProcessing("tenant-a", queuedId);
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") throw new Error("Expected queued knowledge event claim.");
  assert.equal(await service.markProcessed("tenant-a", queuedId, claim.leaseToken), true);
  assert.equal(await enqueuePersistedKnowledgeEvent(
    queue as unknown as Queue<GHLInboundQueueEnvelope>,
    repository,
    "tenant-a",
    "provider-knowledge-event",
  ), false);
  assert.equal(messages.length, 1);
  assert.equal((await repository.find("tenant-a", queuedId))?.processingStatus, "processed");
  database.sqlite.close();
});

function seedDeadLetterEvent(database: SqliteD1Database, status = "dead_letter"): void {
  database.sqlite.prepare(`
    INSERT INTO integration_events (
      event_id, tenant_id, event_type, aggregate_type, aggregate_id,
      provider, occurred_at, received_at, payload, external_event_id,
      processing_status, processing_attempts, last_error_code, last_error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "replay-event", "tenant-a", "KnowledgeBaseRichTextChange", "knowledge_document",
    "doc-1", "gohighlevel", "2026-10-16", "2026-10-16",
    JSON.stringify({ type: "KnowledgeBaseRichTextChange", locationId: "location-a" }),
    "external-replay-event", status, 5, "UNKNOWN", "Private failure details",
  );
  database.sqlite.prepare(`
    INSERT INTO integration_event_dead_letters (
      event_id, tenant_id, error_code, error_message, retryable, attempts, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("replay-event", "tenant-a", "UNKNOWN", "Private failure details", 0, 5, "private payload");
}

test("dead-letter replay submits only persisted identity and duplicate Queue delivery has one effect", async () => {
  const database = createDatabase();
  seedDeadLetterEvent(database);
  const db = database as unknown as D1Database;
  const events = new IntegrationEventRepository(db);
  const deadLetters = new IntegrationEventDeadLetterRepository(db);
  const messages: GHLInboundQueueEnvelope[] = [];
  const queue = { async send(message: GHLInboundQueueEnvelope) { messages.push(message); } } as unknown as Queue<GHLInboundQueueEnvelope>;

  const preview = await inspectIntegrationEventReplay(events, deadLetters, "tenant-a", "replay-event");
  assert.equal(preview?.eligible, true);
  await replayDeadLetterIntegrationEvent(queue, events, deadLetters, "tenant-a", "replay-event");
  assert.deepEqual(messages, [{
    version: 1,
    kind: "event_replay",
    tenantId: "tenant-a",
    provider: "gohighlevel",
    sourceEventId: "replay-event",
  }]);
  assert.equal("payload" in messages[0], false);
  const service = new IntegrationEventService(events);
  let businessEffects = 0;
  const processDelivery = () => processKnowledgeEventWithLease(
    { tenantId: "tenant-a", eventId: "replay-event" },
    service,
    async () => { businessEffects += 1; },
  );
  await Promise.all([processDelivery(), processDelivery()]);
  assert.equal(businessEffects, 1);
  assert.equal((await events.find("tenant-a", "replay-event"))?.processingStatus, "processed");
  database.sqlite.close();
});

test("replay rejects unknown, cross-tenant, processed, and actively leased events", async () => {
  const database = createDatabase();
  seedDeadLetterEvent(database);
  const db = database as unknown as D1Database;
  const events = new IntegrationEventRepository(db);
  const deadLetters = new IntegrationEventDeadLetterRepository(db);
  assert.equal(await inspectIntegrationEventReplay(events, deadLetters, "tenant-b", "replay-event"), null);
  assert.equal(await inspectIntegrationEventReplay(events, deadLetters, "tenant-a", "missing"), null);
  database.sqlite.prepare("UPDATE integration_events SET processing_status = 'processed' WHERE event_id = ?").run("replay-event");
  assert.equal((await inspectIntegrationEventReplay(events, deadLetters, "tenant-a", "replay-event"))?.reason, "already_processed");
  database.sqlite.prepare("UPDATE integration_events SET processing_status = 'processing' WHERE event_id = ?").run("replay-event");
  assert.equal((await inspectIntegrationEventReplay(events, deadLetters, "tenant-a", "replay-event"))?.reason, "currently_processing");
  database.sqlite.close();
});

test("concurrent replay attempts publish once and Queue failure leaves explicit recovery state", async () => {
  const database = createDatabase();
  seedDeadLetterEvent(database);
  const db = database as unknown as D1Database;
  const events = new IntegrationEventRepository(db);
  const deadLetters = new IntegrationEventDeadLetterRepository(db);
  const messages: GHLInboundQueueEnvelope[] = [];
  const queue = { async send(message: GHLInboundQueueEnvelope) { messages.push(message); } } as unknown as Queue<GHLInboundQueueEnvelope>;
  const attempts = await Promise.allSettled([
    replayDeadLetterIntegrationEvent(queue, events, deadLetters, "tenant-a", "replay-event"),
    replayDeadLetterIntegrationEvent(queue, events, deadLetters, "tenant-a", "replay-event"),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(messages.length, 1);

  database.sqlite.prepare(`
    UPDATE integration_events
    SET processing_status = 'dead_letter', processing_attempts = 5,
        last_error_code = 'UNKNOWN', last_error_message = 'Private failure details'
    WHERE event_id = ? AND tenant_id = ?
  `).run("replay-event", "tenant-a");
  const failedQueue = { async send() { throw new Error("Queue unavailable"); } } as unknown as Queue<GHLInboundQueueEnvelope>;
  await assert.rejects(
    replayDeadLetterIntegrationEvent(failedQueue, events, deadLetters, "tenant-a", "replay-event"),
    /remains recoverable/,
  );
  assert.equal((await events.find("tenant-a", "replay-event"))?.lastErrorCode, "OPERATOR_REPLAY_ENQUEUE_FAILED");
  await replayDeadLetterIntegrationEvent(queue, events, deadLetters, "tenant-a", "replay-event");
  assert.equal(messages.length, 2);
  database.sqlite.close();
});

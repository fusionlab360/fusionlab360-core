import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import type { AppBindings } from "../../../src/config/app";
import { queue as workerQueue } from "../../../src/index";
import type { GHLInboundQueueEnvelope } from "../../../src/domain/messaging/inbound-queue-contract";

class LocalD1 {
  private readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    const requiredMigrations = [
      "0001_create_tenants.sql",
      "0003_create_integrations.sql",
      "0004_create_integration_credentials.sql",
      "0008_integration_events.sql",
      "0009_integration_event_revision.sql",
      "0010_integration_event_dead_letters.sql",
      "0017_create_knowledge_sources.sql",
      "0018_create_knowledge_documents.sql",
      "0015_gohighlevel_oauth_installations.sql",
      "0016_oauth_installations.sql",
      "0020_ai_booking_sessions.sql",
      "0021_integration_credential_auth_lifecycle.sql",
      "0023_integration_event_processing.sql",
      "0025_durable_inbound_processing.sql",
      "0029_meta_whatsapp_connections.sql",
      "0030_meta_whatsapp_credential_security.sql",
      "0031_messaging_conversations.sql",
      "0032_meta_whatsapp_outbound.sql",
      "0033_meta_whatsapp_delivery_status.sql",
      "0034_messaging_outbound_messages.sql",
      "0035_provider_neutral_messaging_connections.sql",
    ];
    const availableMigrations = new Set(readdirSync(join(process.cwd(), "migrations")));
    for (const migration of requiredMigrations) {
      assert.ok(availableMigrations.has(migration), `missing migration fixture ${migration}`);
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", migration), "utf8"));
    }
  }

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
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  seedKnowledgeDelete(eventId: string, provider = "gohighlevel"): void {
    this.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')")
      .run("tenant-test", "Synthetic tenant");
    this.sqlite.prepare("INSERT INTO integrations (id, tenant_id, provider, enabled) VALUES (?, ?, ?, 1)")
      .run("integration-test", "tenant-test", "gohighlevel");
    this.sqlite.prepare("INSERT INTO integration_credentials (tenant_id, provider, api_key, location_id) VALUES (?, ?, ?, ?)")
      .run("tenant-test", "gohighlevel", "test-only", "location-test");
    this.sqlite.prepare(`
      INSERT INTO knowledge_sources
        (id, tenant_id, provider, provider_source_id, name, status)
      VALUES (?, ?, 'gohighlevel', ?, ?, 'active')
    `).run("source-test", "tenant-test", "knowledge-base-test", "General knowledge");
    this.sqlite.prepare(`
      INSERT INTO knowledge_documents
        (id, tenant_id, provider, knowledge_source_id, provider_document_id,
         source_type, title, content, status)
      VALUES (?, ?, 'gohighlevel', ?, ?, 'rich_text', ?, ?, 'active')
    `).run("document-test", "tenant-test", "source-test", "document-provider-test", "Synthetic article", "Synthetic indexed content.");
    const payload = JSON.stringify({
      type: "KnowledgeBaseDelete",
      locationId: "location-test",
      id: "knowledge-base-test",
      webhookId: eventId,
      deleted: true,
    });
    this.sqlite.prepare(`
      INSERT INTO integration_events
        (event_id, tenant_id, event_type, aggregate_type, aggregate_id,
         provider, occurred_at, received_at, payload)
      VALUES (?, 'tenant-test', 'KnowledgeBaseDelete', 'knowledge_source',
              'knowledge-base-test', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
    `).run(eventId, provider, payload);
  }

  seedInboundBookingSession(): void {
    this.sqlite.prepare("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')")
      .run("tenant-test", "Synthetic tenant");
    this.sqlite.prepare("INSERT INTO integrations (id, tenant_id, provider, enabled, settings) VALUES (?, ?, ?, 1, ?)")
      .run("integration-test", "tenant-test", "gohighlevel", JSON.stringify({ providerConfiguration: { booking: { offerings: { "calendar-test": { requiredFields: ["customer.fullName", "customer.phone"], persistence: { target: "none", mode: "none" } } } } } }));
    this.sqlite.prepare("INSERT INTO integration_credentials (tenant_id, provider, api_key, location_id) VALUES (?, ?, ?, ?)")
      .run("tenant-test", "gohighlevel", "test-only", "location-test");
    this.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type, offering_id,
        start_at, end_at, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'awaiting_confirmation', 'appointment', ?, ?, ?, ?, ?, ?)
    `).run(
      "tenant-test", "gohighlevel", "conversation-test", "calendar-test",
      "2099-10-20T02:00:00.000Z", "2099-10-20T02:30:00.000Z",
      JSON.stringify({ patientDetailsStatus: "collected", requiredPatientFields: ["full_name", "phone"] }),
      "2026-10-18T00:00:00.000Z", "2026-10-18T00:00:00.000Z",
    );
  }

  scalar(sql: string, ...values: unknown[]): unknown {
    return this.sqlite.prepare(sql).get(...values as never[]);
  }

  close(): void {
    this.sqlite.close();
  }
}

function makeQueueMessage(envelope: GHLInboundQueueEnvelope) {
  const calls: string[] = [];
  const message = {
    body: envelope,
    timestamp: new Date(),
    attempts: 1,
    ack() { calls.push("ack"); },
    retry() { calls.push("retry"); },
  };
  return { message, calls };
}

function makeBindings(db: LocalD1, deleteByIds: (ids: string[]) => Promise<void>): AppBindings {
  const vectorize = {
    async deleteByIds(ids: string[]) {
      await deleteByIds(ids);
      return { mutationId: "synthetic-delete" };
    },
  };
  return {
    DB: db as unknown as D1Database,
    AI: {} as Ai,
    VECTORIZE: {} as Vectorize,
    VECTORIZE_V2: vectorize as unknown as Vectorize,
    JWT_SECRET: "test-only",
    JWT_ISSUER: "test-only",
    JWT_AUDIENCE: "test-only",
    GHL_OAUTH_CLIENT_ID: "test-only",
    GHL_OAUTH_CLIENT_SECRET: "test-only",
    GEMINI_API_KEY: "test-only",
  };
}

function knowledgeEnvelope(eventId: string): GHLInboundQueueEnvelope {
  return {
    version: 1,
    kind: "knowledge",
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: eventId,
  };
}

test("Queue consumer dispatches persisted knowledge deletion once and acknowledges duplicate delivery", async () => {
  const db = new LocalD1();
  db.seedKnowledgeDelete("knowledge-event-test");
  const deletedIds: string[] = [];
  const env = makeBindings(db, async (ids) => { deletedIds.push(...ids); });
  const first = makeQueueMessage(knowledgeEnvelope("knowledge-event-test"));

  try {
    await workerQueue(
      { messages: [first.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    assert.deepEqual(first.calls, ["ack"]);
    assert.deepEqual(deletedIds, ["document-test:chunk:0"]);
    assert.equal((db.scalar("SELECT processing_status FROM integration_events WHERE event_id = ?", "knowledge-event-test") as { processing_status: string }).processing_status, "processed");
    assert.equal((db.scalar("SELECT status FROM knowledge_documents WHERE id = ?", "document-test") as { status: string }).status, "deleted");

    const duplicate = makeQueueMessage(knowledgeEnvelope("knowledge-event-test"));
    await workerQueue(
      { messages: [duplicate.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    assert.deepEqual(duplicate.calls, ["ack"]);
    assert.equal(deletedIds.length, 1);
  } finally {
    db.close();
  }
});

test("history rejection during booking confirmation preserves session and cannot create or reply", async () => {
  const db = new LocalD1();
  db.seedInboundBookingSession();
  const env = makeBindings(db, async () => undefined);
  env.AI_BOOKING_ENABLED = "true";
  const envelope: GHLInboundQueueEnvelope = {
    version: 1,
    kind: "inbound",
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "confirmation-history-failure",
    message: {
      provider: "gohighlevel",
      providerMessageId: "confirmation-history-failure",
      locationId: "location-test",
      conversationId: "conversation-test",
      contactId: "contact-test",
      channel: "SMS",
      text: "yes",
      occurredAt: "2026-10-18T00:00:01.000Z",
    },
  };
  const first = makeQueueMessage(envelope);
  const second = makeQueueMessage(envelope);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json({ message: "private provider response" }, { status: 400 });
  }) as typeof fetch;

  try {
    await workerQueue(
      { messages: [first.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    await workerQueue(
      { messages: [second.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    const session = db.scalar(`
      SELECT status, offering_id, start_at, end_at, data_json
      FROM ai_booking_sessions
      WHERE tenant_id = 'tenant-test' AND provider = 'gohighlevel'
        AND conversation_id = 'conversation-test'
    `) as Record<string, unknown>;
    assert.equal(session.status, "awaiting_confirmation");
    assert.equal(session.offering_id, "calendar-test");
    assert.equal(session.start_at, "2099-10-20T02:00:00.000Z");
    assert.equal(session.end_at, "2099-10-20T02:30:00.000Z");
    assert.equal(JSON.parse(String(session.data_json)).patientDetailsStatus, "collected");
    assert.equal((db.scalar("SELECT COUNT(*) AS count FROM messaging_messages WHERE provider = 'gohighlevel'") as { count: number }).count, 1);
    assert.deepEqual(first.calls, ["retry"]);
    assert.deepEqual(second.calls, ["ack"]);
    assert.equal(requests.length, 1);
    assert.equal(requests.filter(url => url.includes("/messages?")).length, 1);
    assert.equal(requests.some(url => url.includes("/appointments")), false);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Queue consumer rejects a persisted knowledge provider mismatch and follows terminal policy", async () => {
  const db = new LocalD1();
  db.seedKnowledgeDelete("knowledge-provider-mismatch", "other-provider");
  const env = makeBindings(db, async () => { assert.fail("mismatched event reached the knowledge handler"); });
  const message = makeQueueMessage(knowledgeEnvelope("knowledge-provider-mismatch"));

  try {
    await workerQueue(
      { messages: [message.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    assert.deepEqual(message.calls, ["retry"]);
    assert.equal((db.scalar("SELECT processing_status FROM integration_events WHERE event_id = ?", "knowledge-provider-mismatch") as { processing_status: string }).processing_status, "dead_letter");
  } finally {
    db.close();
  }
});

test("Queue consumer records processing-handler failure as retryable and preserves the event", async () => {
  const db = new LocalD1();
  db.seedKnowledgeDelete("knowledge-handler-failure");
  const env = makeBindings(db, async () => { throw new Error("synthetic vector store outage"); });
  const message = makeQueueMessage(knowledgeEnvelope("knowledge-handler-failure"));
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    await workerQueue(
      { messages: [message.message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    assert.deepEqual(message.calls, ["retry"]);
    assert.equal((db.scalar("SELECT processing_status FROM integration_events WHERE event_id = ?", "knowledge-handler-failure") as { processing_status: string }).processing_status, "failed");
    assert.equal((db.scalar("SELECT status FROM knowledge_documents WHERE id = ?", "document-test") as { status: string }).status, "active");
  } finally {
    console.error = originalConsoleError;
    db.close();
  }
});

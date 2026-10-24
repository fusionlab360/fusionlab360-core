import assert from "node:assert/strict";
import test from "node:test";
import { enqueuePersistedKnowledgeEvent } from "../../../src/domain/knowledge/queue-dispatch";
import type { IntegrationEventRepository } from "../../../src/persistence/repositories/integration-event-repository";
import type { GHLInboundQueueEnvelope } from "../../../src/domain/messaging/inbound-queue-contract";

function setup(status: string) {
  const sends: unknown[] = [];
  const event = {
    eventId: "tenant-scoped-event",
    tenantId: "tenant-a",
    eventType: "KnowledgeBaseRichTextChange",
    aggregateType: "knowledge_document",
    aggregateId: "base:rich_text:doc",
    provider: "gohighlevel",
    occurredAt: "2026-10-16T00:00:00.000Z",
    receivedAt: "2026-10-16T00:00:01.000Z",
    payload: "{\"private\":\"payload\"}",
    processingStatus: status,
  };
  const repository = {
    async findByExternalIdentity(tenantId: string, provider: string, sourceId: string) {
      return tenantId === "tenant-a" && provider === "gohighlevel" && sourceId === "provider-event"
        ? event.eventId
        : null;
    },
    async find(tenantId: string, eventId: string) {
      return tenantId === event.tenantId && eventId === event.eventId ? event : null;
    },
  } as unknown as IntegrationEventRepository;
  const queue = {
    async send(message: GHLInboundQueueEnvelope) { sends.push(message); },
  } as unknown as Queue<GHLInboundQueueEnvelope>;
  return { event, repository, queue, sends };
}

test("pending and failed persisted knowledge events re-enqueue only their scoped identity", async () => {
  for (const status of ["received", "failed", "processing"]) {
    const fixture = setup(status);
    assert.equal(await enqueuePersistedKnowledgeEvent(
      fixture.queue, fixture.repository, "tenant-a", "provider-event",
    ), true);
    assert.deepEqual(fixture.sends, [{
      version: 1,
      kind: "knowledge",
      tenantId: "tenant-a",
      provider: "gohighlevel",
      sourceEventId: "tenant-scoped-event",
    }]);
    assert.equal("payload" in (fixture.sends[0] as object), false);
  }
});

test("completed and dead-lettered knowledge events are not resubmitted", async () => {
  for (const status of ["processed", "dead_letter"]) {
    const fixture = setup(status);
    assert.equal(await enqueuePersistedKnowledgeEvent(
      fixture.queue, fixture.repository, "tenant-a", "provider-event",
    ), false);
    assert.equal(fixture.sends.length, 0);
  }
});

test("knowledge-event enqueue failure rejects instead of acknowledging dispatch", async () => {
  const fixture = setup("received");
  const failingQueue = {
    async send() { throw new Error("queue unavailable"); },
  } as unknown as Queue<GHLInboundQueueEnvelope>;
  await assert.rejects(enqueuePersistedKnowledgeEvent(
    failingQueue, fixture.repository, "tenant-a", "provider-event",
  ), /queue unavailable/);
  assert.equal(await enqueuePersistedKnowledgeEvent(
    fixture.queue, fixture.repository, "tenant-a", "provider-event",
  ), true);
  assert.equal(fixture.sends.length, 1);
  await assert.rejects(enqueuePersistedKnowledgeEvent(
    undefined, fixture.repository, "tenant-a", "provider-event",
  ), /Queue binding is not configured/);
});

test("knowledge-event lookup is tenant scoped", async () => {
  const fixture = setup("received");
  await assert.rejects(enqueuePersistedKnowledgeEvent(
    fixture.queue, fixture.repository, "tenant-b", "provider-event",
  ), /could not be found/i);
  assert.equal(fixture.sends.length, 0);
});

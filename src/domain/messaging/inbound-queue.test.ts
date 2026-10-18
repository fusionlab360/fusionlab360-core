import assert from "node:assert/strict";
import test from "node:test";
import { handleGHLInboundQueueBatch } from "./inbound-queue";
import type { GHLInboundQueueEnvelope } from "./inbound-queue-contract";
import type { CanonicalInboundMessage } from "../../canonical/message";

function makeMessage(
  id: string,
  attempts = 1,
  body: GHLInboundQueueEnvelope = { sourceEventId: id } as GHLInboundQueueEnvelope,
  timestamp = new Date(),
): Message<GHLInboundQueueEnvelope> & { outcome: string } {
  const message = {
    id,
    timestamp,
    body,
    attempts,
    outcome: "pending",
    ack() { this.outcome = "acked"; },
    retry() { this.outcome = "retried"; },
  };
  return message as unknown as Message<GHLInboundQueueEnvelope> & { outcome: string };
}

test("queue batch handles each message independently and defers active leases", async () => {
  const completed = makeMessage("completed");
  const active = makeMessage("active");
  const failed = makeMessage("failed");
  const batch = {
    messages: [completed, active, failed],
  } as unknown as MessageBatch<GHLInboundQueueEnvelope>;

  await handleGHLInboundQueueBatch(batch, async (envelope) => {
    return envelope.sourceEventId === "active" ? 45 : null;
  });

  assert.equal(completed.outcome, "acked");
  assert.equal(active.outcome, "retried");
  assert.equal(failed.outcome, "acked");
});

test("one failed Queue message is retried without acknowledging its batch peers", async () => {
  const completed = makeMessage("completed");
  const failed = makeMessage("failed");
  const batch = {
    messages: [completed, failed],
  } as unknown as MessageBatch<GHLInboundQueueEnvelope>;

  await handleGHLInboundQueueBatch(batch, async (envelope) => {
    if (envelope.sourceEventId === "failed") throw new Error("private failure detail");
    return null;
  });

  assert.equal(completed.outcome, "acked");
  assert.equal(failed.outcome, "retried");
});

test("knowledge-event Queue failures are retried without changing inbound envelope handling", async () => {
  const knowledge = makeMessage("knowledge-event", 1, {
    version: 1,
    kind: "knowledge",
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "stored-event-id",
  });
  const inbound = makeMessage("inbound-event");
  const batch = {
    messages: [knowledge, inbound],
  } as unknown as MessageBatch<GHLInboundQueueEnvelope>;

  await handleGHLInboundQueueBatch(batch, async (envelope) => {
    if (envelope.kind === "knowledge") throw new Error("transient index failure");
    return null;
  });

  assert.equal(knowledge.outcome, "retried");
  assert.equal(inbound.outcome, "acked");
});

test("inbound queue receipt and dispatch timings use a hashed correlation only", async () => {
  const inbound = makeMessage("raw-source-event-id", 2, {
    version: 1,
    kind: "inbound",
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "raw-source-event-id",
    message: {
      provider: "gohighlevel",
      providerMessageId: "raw-source-event-id",
      locationId: "location-test",
      conversationId: "conversation-test",
      contactId: "contact-test",
      text: "private customer message",
    } as CanonicalInboundMessage,
  }, new Date(Date.now() - 2_000));
  const batch = { messages: [inbound] } as unknown as MessageBatch<GHLInboundQueueEnvelope>;
  const originalInfo = console.info;
  const logs: unknown[][] = [];
  console.info = ((...args: unknown[]) => logs.push(args)) as typeof console.info;

  try {
    await handleGHLInboundQueueBatch(batch, async () => null);
  } finally {
    console.info = originalInfo;
  }

  const output = JSON.stringify(logs);
  assert.match(output, /queue_received/);
  assert.match(output, /queueWaitMs/);
  assert.match(output, /queue_dispatch/);
  assert.match(output, /queue_consumer/);
  assert.doesNotMatch(output, /raw-source-event-id|private customer message|conversation-test|contact-test/);
  const received = logs.find((entry) => entry[0] === "GHL inbound Queue message received.")?.[1] as Record<string, unknown>;
  assert.equal(typeof received.queueWaitMs, "number");
  assert.match(String(received.correlationId), /^ghl-in-[a-f0-9]{24}$/);
  assert.equal(inbound.outcome, "acked");
});

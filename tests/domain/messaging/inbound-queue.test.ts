import assert from "node:assert/strict";
import test from "node:test";
import { handleGHLInboundQueueBatch } from "../../../src/domain/messaging/inbound-queue";
import { IntegrationEventProcessingError } from "../../../src/core/events/errors";
import type { GHLInboundQueueEnvelope } from "../../../src/domain/messaging/inbound-queue-contract";
import type { CanonicalInboundMessage } from "../../../src/canonical/message";

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

test("permanent provider history rejection is redelivered once to reconcile dead-letter state", async () => {
  const message = makeMessage("history-rejected", 3, {
    version: 1,
    kind: "inbound",
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "history-rejected",
    message: {
      provider: "gohighlevel",
      providerMessageId: "history-rejected",
      locationId: "location-test",
      conversationId: "conversation-test",
      contactId: "contact-test",
      text: "private inbound text",
    } as CanonicalInboundMessage,
  });
  const batch = { messages: [message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>;
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logs.push(args);
  let processingCalls = 0;
  let historyCalls = 0;

  try {
    await handleGHLInboundQueueBatch(batch, async () => {
      processingCalls += 1;
      historyCalls += 1;
      throw new IntegrationEventProcessingError({
        code: "PROVIDER_REQUEST_REJECTED",
        severity: "error",
        message: "Conversation history request was rejected by the provider.",
        retryable: false,
        cause: Object.assign(new Error("safe provider error"), {
          operation: "conversation_history",
          httpStatus: 400,
          providerErrorCode: "INVALID_REQUEST",
          retryable: false,
        }),
      });
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(message.outcome, "retried");
  const queueFailure = logs.find((entry) => entry[0] === "GHL inbound Queue message processing failed.");
  assert.ok(queueFailure);
  const diagnostic = queueFailure[1] as Record<string, unknown>;
  assert.equal(diagnostic.attemptCount, 3);
  assert.equal(diagnostic.retryClassification, "permanent");
  assert.equal(diagnostic.queueAction, "retry_for_event_state_reconciliation");
  assert.equal(diagnostic.classification, "provider_http");
  assert.equal(diagnostic.httpStatus, 400);
  assert.equal(diagnostic.providerErrorCode, "INVALID_REQUEST");
  assert.match(String(diagnostic.correlationId), /^ghl-in-[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(logs).includes("private inbound text"), false);
  assert.equal(JSON.stringify(logs).includes("safe provider error"), false);

  const terminalRedelivery = makeMessage("history-rejected", 4, message.body);
  await handleGHLInboundQueueBatch(
    { messages: [terminalRedelivery] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
    async () => {
      processingCalls += 1;
      return null;
    },
  );
  assert.equal(terminalRedelivery.outcome, "acked");
  assert.equal(processingCalls, 2);
  assert.equal(historyCalls, 1);
});

test("retryable history provider failures can recover on a later delivery", async () => {
  const message = makeMessage("history-transient", 1);
  const batch = { messages: [message] } as unknown as MessageBatch<GHLInboundQueueEnvelope>;
  let retrievalAttempts = 0;

  await handleGHLInboundQueueBatch(batch, async () => {
    retrievalAttempts += 1;
    if (retrievalAttempts === 1) {
      throw Object.assign(new Error("temporary failure"), { retryable: true });
    }
    return null;
  });
  assert.equal(message.outcome, "retried");

  const recovery = makeMessage("history-transient", 2);
  await handleGHLInboundQueueBatch(
    { messages: [recovery] } as unknown as MessageBatch<GHLInboundQueueEnvelope>,
    async () => {
      retrievalAttempts += 1;
      return null;
    },
  );
  assert.equal(recovery.outcome, "acked");
  assert.equal(retrievalAttempts, 2);
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

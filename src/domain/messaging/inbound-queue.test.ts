import assert from "node:assert/strict";
import test from "node:test";
import { handleGHLInboundQueueBatch } from "./inbound-queue";
import type { GHLInboundQueueEnvelope } from "./inbound-queue-contract";

function makeMessage(
  id: string,
  attempts = 1,
): Message<GHLInboundQueueEnvelope> & { outcome: string } {
  const message = {
    id,
    timestamp: new Date(),
    body: { sourceEventId: id } as GHLInboundQueueEnvelope,
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

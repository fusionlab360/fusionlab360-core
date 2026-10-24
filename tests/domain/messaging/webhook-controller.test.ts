import assert from "node:assert/strict";
import test from "node:test";

import {
  awaitInboundMessageProcessing,
  ghlInboundMessageController,
  respondAfterInboundQueueAcceptance,
  respondAfterInboundMessageProcessing,
} from "../../../src/domain/messaging/webhook-controller";
import { InboundEventLeaseActiveError } from "../../../src/domain/messaging/inbound-service";
import { publishGHLInboundQueueEvent } from "../../../src/domain/messaging/inbound-queue";
import type { GHLInboundQueueEnvelope } from "../../../src/domain/messaging/inbound-queue-contract";

test("inbound webhook processing stays pending until required work resolves", async () => {
  let completeWork!: () => void;
  let handlerWorkCompleted = false;
  const requiredWork = new Promise<void>((resolve) => {
    completeWork = resolve;
  });

  const handlerCompletion = awaitInboundMessageProcessing(requiredWork).then(() => {
    handlerWorkCompleted = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handlerWorkCompleted, false);

  completeWork();
  await handlerCompletion;

  assert.equal(handlerWorkCompleted, true);
});

test("inbound processing failure returns a retryable failure response", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    let acknowledged = false;
    const response = await respondAfterInboundMessageProcessing(
      Promise.reject(new Error("private D1 failure detail")),
      () => {
        acknowledged = true;
        return { status: 200, body: { success: true, accepted: true } };
      },
      () => ({ status: 503, body: { success: false } }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { success: false });
    assert.equal(acknowledged, false);

    const activeLeaseResult = await awaitInboundMessageProcessing(
      Promise.reject(new InboundEventLeaseActiveError(37)),
    );
    assert.deepEqual(activeLeaseResult, {
      success: false,
      retryAfterSeconds: 37,
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("inbound success response waits until processing resolves", async () => {
  let finish!: () => void;
  let acknowledged = false;
  const processing = new Promise<void>((resolve) => { finish = resolve; });
  const response = respondAfterInboundMessageProcessing(
    processing,
    () => {
      acknowledged = true;
      return { status: 200 };
    },
    () => ({ status: 503 }),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(acknowledged, false);
  finish();
  assert.deepEqual(await response, { status: 200 });
  assert.equal(acknowledged, true);
});

test("durable webhook acceptance waits for Queue publication and propagates publish failure", async () => {
  let resolvePublish!: () => void;
  const publish = new Promise<void>((resolve) => {
    resolvePublish = resolve;
  });
  let accepted = false;
  const envelope = {
    version: 1,
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "source-event-test",
    message: {},
  } as GHLInboundQueueEnvelope;
  const queue = {
    async send() {
      await publish;
    },
  } as unknown as Queue<GHLInboundQueueEnvelope>;

  const accepting = publishGHLInboundQueueEvent(queue, envelope).then(() => {
    accepted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(accepted, false);
  resolvePublish();
  await accepting;
  assert.equal(accepted, true);

  const failingQueue = {
    async send() {
      throw new Error("private Queue transport detail");
    },
  } as unknown as Queue<GHLInboundQueueEnvelope>;
  await assert.rejects(publishGHLInboundQueueEvent(failingQueue, envelope));
  await assert.rejects(
    publishGHLInboundQueueEvent(undefined, envelope),
    /Queue binding is not configured/i,
  );
});

test("Queue-mode webhook acknowledges only after durable publication", async () => {
  let resolvePublish!: () => void;
  let acknowledged = false;
  const queue = {
    async send() {
      await new Promise<void>((resolve) => { resolvePublish = resolve; });
    },
  } as unknown as Queue<GHLInboundQueueEnvelope>;
  const envelope = {
    version: 1,
    tenantId: "tenant-test",
    provider: "gohighlevel",
    sourceEventId: "event-test",
    message: {},
  } as GHLInboundQueueEnvelope;

  const response = respondAfterInboundQueueAcceptance(
    queue,
    envelope,
    () => {
      acknowledged = true;
      return { status: 200 };
    },
    () => ({ status: 503 }),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(acknowledged, false);
  resolvePublish();
  assert.deepEqual(await response, { status: 200 });
  assert.equal(acknowledged, true);

  const missingBinding = await respondAfterInboundQueueAcceptance(
    undefined,
    envelope,
    () => ({ status: 200 }),
    () => ({ status: 503 }),
  );
  assert.deepEqual(missingBinding, { status: 503 });

  const failingQueue = {
    async send() { throw new Error("private Queue transport response"); },
  } as unknown as Queue<GHLInboundQueueEnvelope>;
  const publishFailure = await respondAfterInboundQueueAcceptance(
    failingQueue,
    envelope,
    () => ({ status: 200 }),
    () => ({ status: 503 }),
  );
  assert.deepEqual(publishFailure, { status: 503 });
});

test("invalid GHL signature is rejected before Queue publication", async () => {
  let queueCalls = 0;
  const body = JSON.stringify({
    type: "InboundMessage",
    locationId: "location-test",
    body: "private inbound body",
  });
  const context = {
    req: {
      async text() { return body; },
      header() { return "N/A"; },
    },
    env: {
      GHL_INBOUND_QUEUE_ENABLED: "true",
      GHL_INBOUND_QUEUE: {
        async send() { queueCalls += 1; },
      },
    },
    json(data: unknown, status: number) {
      return { data, status };
    },
  };

  const response = await ghlInboundMessageController(
    context as unknown as Parameters<typeof ghlInboundMessageController>[0],
  ) as { status: number };

  assert.equal(response.status, 401);
  assert.equal(queueCalls, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalInboundMessage } from "../../canonical/message";
import type { AIProvider } from "../../core/ai";
import type { MessagingProvider } from "../../core/messaging";
import type { IntegrationContext } from "../../context/integration";
import {
  classifyInboundProcessingError,
  processGHLInboundMessage,
  runInboundProcessingOperation,
  shouldRunBookingIntentExtraction,
} from "./inbound-service";
import {
  createInboundCorrelationId,
  getInboundEventAgeMs,
  logInboundCheckpoint,
  logInboundExecutionPath,
} from "./inbound-diagnostics";

test("inbound processing errors use bounded classifications", () => {
  assert.equal(classifyInboundProcessingError(new Error("no such column: external_event_id")), "database_schema");
  assert.equal(classifyInboundProcessingError(new Error("UNIQUE constraint failed")), "database_constraint");
  assert.equal(classifyInboundProcessingError(new Error("D1 database is overloaded")), "database_unavailable");
  assert.equal(classifyInboundProcessingError(new Error("canceled", { cause: Object.assign(new Error("cancelled"), { name: "AbortError" }) })), "cancelled");
  assert.equal(classifyInboundProcessingError(Object.assign(new Error("deadline"), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyInboundProcessingError(new Error("private provider detail")), "unknown");
});

test("provider event age is measurable without exposing message identifiers", () => {
  const receivedAt = Date.parse("2026-10-16T13:27:52.693Z");
  assert.equal(
    getInboundEventAgeMs("2026-10-16T13:27:50.000Z", receivedAt),
    2693,
  );
  assert.equal(getInboundEventAgeMs("invalid", receivedAt), null);
  assert.equal(
    getInboundEventAgeMs("2026-10-16T13:27:53.000Z", receivedAt),
    0,
  );
});

test("clearly informational knowledge questions skip booking intent extraction when no session is active", () => {
  const noSession = {
    bookingSessionActive: false,
    confirmedBookingActionRequested: false,
    confirmedBookingActionPending: false,
  };

  assert.equal(
    shouldRunBookingIntentExtraction({
      ...noSession,
      message: "What service your clinic provide?",
    }),
    false,
  );
  assert.equal(
    shouldRunBookingIntentExtraction({
      ...noSession,
      message: "What are your opening hours?",
    }),
    false,
  );
});

test("booking, availability, ambiguous messages, and active sessions retain booking intent extraction", () => {
  const noSession = {
    bookingSessionActive: false,
    confirmedBookingActionRequested: false,
    confirmedBookingActionPending: false,
  };

  for (const message of [
    "I want to book an appointment",
    "Do you have an appointment slot available?",
    "Can you help me?",
  ]) {
    assert.equal(
      shouldRunBookingIntentExtraction({ ...noSession, message }),
      true,
      message,
    );
  }

  assert.equal(
    shouldRunBookingIntentExtraction({
      ...noSession,
      message: "What services do you provide?",
      bookingSessionActive: true,
    }),
    true,
  );
  assert.equal(
    shouldRunBookingIntentExtraction({
      ...noSession,
      message: "Can I know the address?",
      confirmedBookingActionRequested: true,
    }),
    true,
  );
});

test("AI lifecycle failure identifies a fixed stage without logging private error details", async () => {
  const diagnostics: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => diagnostics.push(args);

  try {
    await assert.rejects(
      runInboundProcessingOperation("ai_generation", "ghl-in-correlation-test", async () => {
        throw new Error("private model response and customer text");
      }),
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], "GHL inbound lifecycle checkpoint.");
  const checkpoint = diagnostics[0][1] as Record<string, unknown>;
  assert.equal(checkpoint.operation, "ai_generation");
  assert.equal(checkpoint.phase, "failed");
  assert.equal(checkpoint.correlationId, "ghl-in-correlation-test");
  assert.equal(checkpoint.classification, "unknown");
  assert.equal(typeof checkpoint.elapsedMs, "number");
  assert.equal(JSON.stringify(diagnostics).includes("private model response"), false);
});

test("post-thinking checkpoints use bounded stages, outcomes, paths, and safe errors", async () => {
  const entries: unknown[][] = [];
  const original = { info: console.info, error: console.error };
  const capture = (...args: unknown[]) => entries.push(args);
  console.info = capture;
  console.error = capture;

  try {
    const correlationId = "ghl-in-correlation-test";
    await runInboundProcessingOperation("booking_intent", correlationId, async () => undefined);
    await runInboundProcessingOperation("ai_thinking_delay", correlationId, async () => undefined);
    await assert.rejects(
      runInboundProcessingOperation("post_thinking_history_fetch", correlationId, async () => {
        throw new Error("private customer and provider response detail");
      }),
    );
    logInboundCheckpoint(
      "newer_message_check",
      "complete",
      correlationId,
      performance.now(),
      undefined,
      "newer_message",
    );
    logInboundCheckpoint(
      "newer_message_check",
      "complete",
      correlationId,
      performance.now(),
      undefined,
      "no_newer_message",
    );
    logInboundExecutionPath("synchronous_webhook", correlationId);
    logInboundExecutionPath("queue_consumer", correlationId);
  } finally {
    console.info = original.info;
    console.error = original.error;
  }

  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes("private customer and provider response detail"), false);
  const checkpoints = entries
    .filter((entry) => entry[0] === "GHL inbound lifecycle checkpoint.")
    .map((entry) => entry[1] as Record<string, unknown>);
  assert.deepEqual(
    [...new Set(checkpoints.map((entry) => entry.operation))].sort(),
    [
      "ai_thinking_delay",
      "booking_intent",
      "newer_message_check",
      "post_thinking_history_fetch",
      "queue_consumer",
      "synchronous_webhook",
    ],
  );
  assert.equal(checkpoints.some((entry) => entry.classification === "unknown"), true);
  assert.equal(checkpoints.every((entry) =>
    entry.classification === undefined || [
      "database_schema",
      "database_constraint",
      "database_unavailable",
      "cancelled",
      "timeout",
      "unknown",
    ].includes(String(entry.classification))
  ), true);
  assert.equal(checkpoints.some((entry) => entry.outcome === "newer_message"), true);
  assert.equal(checkpoints.some((entry) => entry.outcome === "no_newer_message"), true);
  assert.equal(checkpoints.every((entry) => entry.correlationId === "ghl-in-correlation-test"), true);
  assert.equal(checkpoints.every((entry) => [
    "ai_thinking_delay",
    "booking_intent",
    "newer_message_check",
    "post_thinking_history_fetch",
    "queue_consumer",
    "synchronous_webhook",
  ].includes(String(entry.operation))), true);
  assert.equal(checkpoints.every((entry) => Object.keys(entry).every((key) => [
    "operation",
    "phase",
    "correlationId",
    "elapsedMs",
    "classification",
    "outcome",
  ].includes(key))), true);
});

test("event acceptance failure logs only its fixed stage and safe classification", async () => {
  const privateDetail = "no such column: external_event_id private SQL detail";
  const diagnostics: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => diagnostics.push(args);

  try {
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async first() { throw new Error(privateDetail); },
        };
      },
    } as unknown as D1Database;
    const context = { tenant: { id: "tenant-test", name: "Test Tenant" } } as unknown as IntegrationContext;
    const message = {
      provider: "gohighlevel",
      providerMessageId: "event-test",
      locationId: "location-test",
      conversationId: "conversation-test",
      contactId: "contact-test",
      channel: "sms",
      text: "private customer message",
      occurredAt: "2026-10-12T10:00:00.000Z",
    } as CanonicalInboundMessage;

    await assert.rejects(processGHLInboundMessage(
      db,
      context,
      {} as AIProvider,
      {} as MessagingProvider,
      message,
      { async search() { return []; } },
    ));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], "GHL inbound lifecycle checkpoint.");
  const correlationId = await createInboundCorrelationId("event-test");
  const checkpoint = diagnostics[0][1] as Record<string, unknown>;
  assert.equal(checkpoint.operation, "event_accept");
  assert.equal(checkpoint.phase, "failed");
  assert.equal(checkpoint.correlationId, correlationId);
  assert.equal(checkpoint.classification, "database_schema");
  assert.equal(typeof checkpoint.elapsedMs, "number");
  assert.equal(JSON.stringify(diagnostics).includes(privateDetail), false);
  assert.equal(JSON.stringify(diagnostics).includes("private customer message"), false);
});

test("duplicate inbound event claim exits before handoff or reply side effects", async () => {
  let recentMessageReads = 0;
  let sendCalls = 0;
  let aiCalls = 0;
  const infoEntries: unknown[][] = [];
  const originalConsoleInfo = console.info;
  console.info = (...args: unknown[]) => infoEntries.push(args);

  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async first<T>() {
          if (sql.includes("external_event_id")) {
            return { event_id: "duplicate-inbound-event" } as T;
          }
          if (sql.includes("processing_status")) {
            return {
              processing_status: "processed",
              processing_attempts: 1,
              processing_lease_expires_at: null,
              processing_started_at: null,
            } as T;
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
    },
  } as unknown as D1Database;

  const context = {
    tenant: { id: "tenant-test", name: "Test Tenant" },
  } as unknown as IntegrationContext;
  const message = {
    provider: "gohighlevel",
    providerMessageId: "duplicate-inbound-event",
    locationId: "location-test",
    conversationId: "conversation-test",
    contactId: "contact-test",
    channel: "sms",
    text: "Yes.",
    occurredAt: "2026-10-12T10:00:00.000Z",
  } as CanonicalInboundMessage;

  const messaging = {
    async getRecentMessages() {
      recentMessageReads += 1;
      return [];
    },
    async sendText() {
      sendCalls += 1;
      return { messageId: "unexpected-send", conversationId: "conversation-test" };
    },
  } as unknown as MessagingProvider;
  const ai = {
    async chat() {
      aiCalls += 1;
      return { text: "unexpected generation" };
    },
    async chatFallback() {
      aiCalls += 1;
      return { text: "unexpected fallback" };
    },
  } as unknown as AIProvider;

  try {
    await processGHLInboundMessage(
      db,
      context,
      ai,
      messaging,
      message,
      { async search() { return []; } },
      false,
      undefined,
      "queue_consumer",
    );
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.equal(recentMessageReads, 0);
  assert.equal(sendCalls, 0);
  assert.equal(aiCalls, 0);
  assert.equal(infoEntries.some((entry) =>
    (entry[1] as Record<string, unknown>)?.operation === "queue_consumer"
  ), false);
});

test("lifecycle diagnostics include available Worker version identity and tolerate missing metadata", async () => {
  const entries: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => entries.push(args);
  try {
    await runInboundProcessingOperation(
      "knowledge_retrieval",
      "ghl-in-version-test",
      async () => undefined,
      {
        id: "version-lifecycle-1",
        tag: "staging",
        timestamp: "2026-10-14T00:00:00.000Z",
      },
    );
    await runInboundProcessingOperation(
      "knowledge_retrieval",
      "ghl-in-version-missing",
      async () => undefined,
    );
  } finally {
    console.info = original;
  }
  const checkpoints = entries
    .filter((entry) => entry[0] === "GHL inbound lifecycle checkpoint.")
    .map((entry) => entry[1] as Record<string, unknown>);
  assert.equal(checkpoints[0]?.workerVersionId, "version-lifecycle-1");
  assert.equal(checkpoints[0]?.workerVersionTag, "staging");
  assert.equal(checkpoints[0]?.workerVersionTimestamp, "2026-10-14T00:00:00.000Z");
  assert.equal(checkpoints[2]?.workerVersionId, undefined);
  assert.equal(JSON.stringify(entries).includes("customer text"), false);
});

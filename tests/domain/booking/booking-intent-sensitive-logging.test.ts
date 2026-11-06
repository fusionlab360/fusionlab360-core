import assert from "node:assert/strict";
import test from "node:test";

import type { AIProvider } from "../../../src/core/ai";
import { extractBookingIntent } from "../../../src/domain/booking/booking-intent";

async function captureBookingIntentLogs(ai: AIProvider): Promise<string> {
  const originalLog = console.log;
  const originalError = console.error;
  const entries: unknown[][] = [];
  const capture = (...args: unknown[]) => entries.push(args);
  console.log = capture;
  console.error = capture;

  try {
    await extractBookingIntent(
      ai,
      [],
      "customer message private sentinel",
      "2026-11-07T00:00:00.000Z",
      null,
    );
    return JSON.stringify(entries);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("malformed booking intent output is not written to logs", async () => {
  const privateModelOutput = '{"reason":"BOOKING_PRIVATE_SENTINEL",}';
  const logs = await captureBookingIntentLogs({
    async chat() {
      return { text: privateModelOutput, provider: "synthetic", model: "synthetic" };
    },
  });

  assert.match(logs, /JSON PARSE FAILED/);
  assert.match(logs, /responseLength/);
  assert.equal(logs.includes("BOOKING_PRIVATE_SENTINEL"), false);
  assert.equal(logs.includes("customer message private sentinel"), false);
});

test("booking intent provider exception text and stack are not logged", async () => {
  const privateProviderError = "BOOKING_PROVIDER_PRIVATE_SENTINEL";
  const logs = await captureBookingIntentLogs({
    async chat() {
      throw new Error(privateProviderError);
    },
  });

  assert.match(logs, /AI REQUEST FAILED/);
  assert.match(logs, /errorType/);
  assert.equal(logs.includes(privateProviderError), false);
  assert.equal(logs.includes("customer message private sentinel"), false);
});

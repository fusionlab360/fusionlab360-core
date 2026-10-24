import assert from "node:assert/strict";
import test from "node:test";

import { createProviderAttemptSignal } from "../../../src/core/ai/provider-timeout";

test("provider timeout aborts the underlying operation signal", async () => {
  const signal = createProviderAttemptSignal(undefined, 5);
  let underlyingRequestAborted = false;
  const slowRequest = new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      underlyingRequestAborted = true;
      resolve();
    }, { once: true });
  });

  await slowRequest;
  assert.equal(signal.aborted, true);
  assert.equal(underlyingRequestAborted, true);
});

test("overall generation deadline is propagated into provider attempt signal", () => {
  const controller = new AbortController();
  const signal = createProviderAttemptSignal(controller.signal, 60_000);
  controller.abort();
  assert.equal(signal.aborted, true);
});

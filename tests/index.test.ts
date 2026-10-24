
import assert from "node:assert/strict";
import test from "node:test";

import worker, { queue, scheduled } from "../src/index";

test("Worker default handler exposes HTTP, Queue and scheduled entry points", () => {
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof worker.queue, "function");
  assert.equal(typeof worker.scheduled, "function");

  assert.equal(typeof queue, "function");
  assert.equal(typeof scheduled, "function");

  // createWorker intentionally wraps the exported handlers.
  assert.notEqual(worker.queue, queue);
  assert.notEqual(worker.scheduled, scheduled);
});

import assert from "node:assert/strict";
import test from "node:test";
import worker, { queue } from "./index";

test("Worker default handler exposes both HTTP and Queue entry points", () => {
  assert.equal(typeof worker.fetch, "function");
  assert.equal(worker.queue, queue);
});

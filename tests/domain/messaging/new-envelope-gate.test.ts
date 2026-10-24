import assert from "node:assert/strict";
import test from "node:test";

import {
  areNewQueueEnvelopesEnabled,
} from "../../../src/domain/messaging/inbound-queue";

test("new reservation and Meta Queue envelopes are disabled by default", () => {
  assert.equal(areNewQueueEnvelopesEnabled({}), false);
  assert.equal(areNewQueueEnvelopesEnabled({ NEW_QUEUE_ENVELOPES_ENABLED: "false" }), false);
});

test("new Queue envelope publishing requires explicit activation", () => {
  assert.equal(areNewQueueEnvelopesEnabled({ NEW_QUEUE_ENVELOPES_ENABLED: "true" }), true);
  assert.equal(areNewQueueEnvelopesEnabled({ NEW_QUEUE_ENVELOPES_ENABLED: "1" }), false);
});

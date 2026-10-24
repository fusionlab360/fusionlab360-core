import assert from "node:assert/strict";
import test from "node:test";
import { processKnowledgeEventWithLease } from "../../../src/domain/knowledge/queue-processing";
import type { IntegrationEventService } from "../../../src/core/events/service";

function makeService(claimState: string = "claimed") {
  const calls: string[] = [];
  const service = {
    async claimForProcessing() {
      calls.push("claim");
      return claimState === "claimed"
        ? { state: "claimed", leaseToken: "lease-1", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }
        : claimState === "active"
          ? { state: "active", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }
          : { state: claimState };
    },
    async renewProcessingLease() { calls.push("renew"); return true; },
    async markProcessed() { calls.push("processed"); return true; },
    async markFailed(_tenantId: string, _eventId: string, error: unknown) {
      calls.push(error instanceof Error ? `failed:${error.message}` : "failed");
    },
  } as unknown as IntegrationEventService;
  return { service, calls };
}

const event = { tenantId: "tenant-a", eventId: "stored-event-1" };

test("claimed knowledge event dispatch marks processed only after handler success", async () => {
  const fixture = makeService();
  let businessEffects = 0;
  const result = await processKnowledgeEventWithLease(event, fixture.service, async () => {
    businessEffects += 1;
  });
  assert.equal(result, null);
  assert.equal(businessEffects, 1);
  assert.deepEqual(fixture.calls, ["claim", "processed"]);
});

test("knowledge handler failure records failure and is rethrown for bounded Queue retry", async () => {
  const fixture = makeService();
  await assert.rejects(processKnowledgeEventWithLease(event, fixture.service, async () => {
    throw new Error("transient index failure");
  }), /transient index failure/);
  assert.deepEqual(fixture.calls, ["claim", "failed:transient index failure"]);
});

test("active and terminal knowledge-event claims do not repeat business effects", async () => {
  const active = makeService("active");
  let calls = 0;
  const retryAfter = await processKnowledgeEventWithLease(event, active.service, async () => { calls += 1; });
  assert.ok(retryAfter && retryAfter > 0);
  assert.equal(calls, 0);

  const terminal = makeService("processed");
  assert.equal(await processKnowledgeEventWithLease(event, terminal.service, async () => { calls += 1; }), null);
  assert.equal(calls, 0);
  assert.deepEqual(terminal.calls, ["claim"]);
});

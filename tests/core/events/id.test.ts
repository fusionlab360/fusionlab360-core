import assert from "node:assert/strict";
import test from "node:test";
import { createTenantScopedEventId } from "../../../src/core/events/id";

test("integration event identity is stable and scoped by tenant and provider", async () => {
  const same = await createTenantScopedEventId("tenant-a", "gohighlevel", "message-1");
  const repeat = await createTenantScopedEventId("tenant-a", "gohighlevel", "message-1");
  const otherTenant = await createTenantScopedEventId("tenant-b", "gohighlevel", "message-1");
  const otherProvider = await createTenantScopedEventId("tenant-a", "other-provider", "message-1");

  assert.equal(same, repeat);
  assert.notEqual(same, otherTenant);
  assert.notEqual(same, otherProvider);
  assert.match(same, /^evt_[a-f0-9]{64}$/);
});

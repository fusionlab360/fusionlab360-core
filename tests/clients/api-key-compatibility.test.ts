import assert from "node:assert/strict";
import test from "node:test";
import { hashApiKey } from "../../src/core/security/api-key";
import { parsePermissionScopes } from "../../src/clients/permissions";

test("existing fl360 API key hashing remains SHA-256 compatible", async () => {
  const key = "fl360_synthetic_legacy_key";
  const first = await hashApiKey(key);
  const second = await hashApiKey(key);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, await hashApiKey(`${key}-wrong`));
});

test("new Console service scopes are additive and legacy scopes remain valid", () => {
  assert.deepEqual(parsePermissionScopes(["contacts:read", "reservations:sync", "messaging:read"]), ["contacts:read", "reservations:sync", "messaging:read"]);
  assert.deepEqual(parsePermissionScopes(["tenants:provision", "tenants:read", "messaging:read"]), ["tenants:provision", "tenants:read", "messaging:read"]);
  assert.throws(() => parsePermissionScopes(["*"]), /Unsupported permission scope/);
});

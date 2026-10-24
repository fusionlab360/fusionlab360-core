import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectClientPermissions,
  updateClientPermissions,
} from "../../src/clients/service";
import { parsePermissionScopes } from "../../src/clients/permissions";
import type { ClientRecord } from "../../src/persistence/models/client";

function createDb(initialPermissions: string, recordTenant = "tenant-a") {
  const record: ClientRecord = {
    id: "client-a",
    tenant_id: recordTenant,
    name: "Synthetic Client",
    api_key_hash: "hash-not-used",
    status: "active",
    permissions: initialPermissions,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first<T>() {
          calls.push({ sql, values });
          if (!sql.includes("WHERE tenant_id = ? AND id = ?")) return null;
          if (values[0] !== recordTenant || values[1] !== record.id) return null;
          return { ...record } as T;
        },
        async run() {
          calls.push({ sql, values });
          if (
            values[1] !== recordTenant ||
            values[2] !== record.id ||
            values[3] !== record.permissions
          ) {
            return { meta: { changes: 0 } };
          }
          record.permissions = String(values[0]);
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls, record };
}

test("permission inspection returns only the exact tenant-scoped client", async () => {
  const { db, calls } = createDb(JSON.stringify(["contacts:read"]));
  const result = await inspectClientPermissions(db, "tenant-a", "client-a");
  assert.deepEqual(result.permissions, ["contacts:read"]);
  assert.match(calls[0].sql, /WHERE tenant_id = \? AND id = \?/);
  assert.deepEqual(calls[0].values, ["tenant-a", "client-a"]);
});

test("OAuth onboarding scope is available for explicit least-privilege provisioning", () => {
  assert.deepEqual(
    parsePermissionScopes(["integrations:oauth:connect"]),
    ["integrations:oauth:connect"],
  );
});

test("grant adds explicitly selected scopes and preserves unrelated grants", async () => {
  const { db, record, calls } = createDb(JSON.stringify(["contacts:read", "ai:read"]));
  const result = await updateClientPermissions(
    db,
    "tenant-a",
    "client-a",
    "grant",
    ["knowledge:read"],
  );
  assert.deepEqual(result.added, ["knowledge:read"]);
  assert.deepEqual(result.client.permissions, ["contacts:read", "ai:read", "knowledge:read"]);
  assert.equal(record.permissions, JSON.stringify(result.client.permissions));
  const update = calls.find(({ sql }) => sql.includes("UPDATE clients"));
  assert.ok(update);
  assert.match(update.sql, /WHERE tenant_id = \? AND id = \? AND permissions = \?/);
  assert.deepEqual(update.values.slice(1), ["tenant-a", "client-a", JSON.stringify(["contacts:read", "ai:read"])]);
});

test("revoke removes only selected grants and preserves unrelated grants", async () => {
  const { db } = createDb(JSON.stringify(["contacts:read", "ai:read", "features:read"]));
  const result = await updateClientPermissions(
    db,
    "tenant-a",
    "client-a",
    "revoke",
    ["ai:read"],
  );
  assert.deepEqual(result.removed, ["ai:read"]);
  assert.deepEqual(result.client.permissions, ["contacts:read", "features:read"]);
});

test("unknown and malformed requested scopes are rejected", async () => {
  assert.throws(() => parsePermissionScopes(["contacts:read; DROP TABLE clients"]), /Unsupported/);
  assert.throws(() => parsePermissionScopes([" contacts:read"]), /whitespace/);
  assert.throws(() => parsePermissionScopes(["*"]), /Unsupported/);
  const { db, calls } = createDb(JSON.stringify([]));
  await assert.rejects(
    updateClientPermissions(db, "tenant-a", "client-a", "grant", ["unknown:write"]),
    /Unsupported/,
  );
  assert.equal(calls.length, 0);
});

test("wrong tenant or client cannot inspect or update another client's record", async () => {
  const { db, calls, record } = createDb(JSON.stringify(["contacts:read"]));
  await assert.rejects(
    updateClientPermissions(db, "tenant-b", "client-a", "grant", ["ai:read"]),
    /not found for the specified tenant/,
  );
  await assert.rejects(
    updateClientPermissions(db, "tenant-a", "client-b", "grant", ["ai:read"]),
    /not found for the specified tenant/,
  );
  assert.equal(calls.some(({ sql }) => sql.includes("UPDATE clients")), false);
  assert.equal(record.permissions, JSON.stringify(["contacts:read"]));
});

test("malformed stored permissions fail closed", async () => {
  const { db } = createDb("not-json");
  await assert.rejects(
    inspectClientPermissions(db, "tenant-a", "client-a"),
    SyntaxError,
  );
  await assert.rejects(
    updateClientPermissions(db, "tenant-a", "client-a", "grant", ["ai:read"]),
    SyntaxError,
  );
});

test("legacy wildcard can be explicitly revoked but never granted", async () => {
  const { db } = createDb(JSON.stringify(["*", "contacts:read"]));
  await assert.rejects(
    updateClientPermissions(db, "tenant-a", "client-a", "grant", ["*"]),
    /Unsupported/,
  );
  const result = await updateClientPermissions(
    db,
    "tenant-a",
    "client-a",
    "revoke",
    ["*"],
  );
  assert.deepEqual(result.client.permissions, ["contacts:read"]);
});

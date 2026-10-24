import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { hashApiKey } from "../../../../src/core/security/api-key";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { IntegrationRecord } from "../../../../src/persistence/models/integration";
import staahRoutes from "../../../../src/integrations/channel-manager/staah/staah-routes";

class ManagementDatabase {
  readonly tenant = {
    id: "tenant-a",
    name: "Tenant A",
    status: "active",
    created_at: "synthetic",
    updated_at: "synthetic",
  };
  readonly integrations = new Map<string, IntegrationRecord>();
  clientPermissions = ["integrations:read", "integrations:write"];
  apiKeyHash = "";
  failIntegrationReads = false;

  seed(tenantId: string, id: string) {
    const settings = JSON.stringify({
      providerConfiguration: {
        category: "channel_manager",
        mode: "mock",
        profile: "crm",
        syntheticPropertyId: `mock-${id}`,
        simulateVerificationFailure: false,
      },
      verification: {
        currentStatus: "configured_not_verified",
        lastAttemptAt: null,
        lastResult: null,
        reason: null,
      },
    });
    this.integrations.set(`${tenantId}:staah`, {
      id,
      tenant_id: tenantId,
      provider: "staah",
      enabled: 1,
      settings,
      created_at: "synthetic",
      updated_at: "synthetic",
    });
  }

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => {
        values = bindings;
        return statement;
      },
      first: async <T>() => {
        if (/FROM clients/i.test(sql)) {
          if (sql.includes("api_key_hash")) {
            return (this.apiKeyHash && values[0] === this.apiKeyHash
              ? {
                  id: "client-a",
                  tenant_id: "tenant-a",
                  name: "Client A",
                  api_key_hash: this.apiKeyHash,
                  status: "active",
                  permissions: JSON.stringify(this.clientPermissions),
                  created_at: "synthetic",
                  updated_at: "synthetic",
                }
              : null) as T | null;
          }
        }
        if (/FROM tenants/i.test(sql)) {
          return (values[0] === "tenant-a" ? this.tenant : null) as T | null;
        }
        if (/FROM integrations/i.test(sql)) {
          if (this.failIntegrationReads) throw new Error("synthetic database detail");
          const record = this.integrations.get(`${String(values[0])}:${String(values[1])}`);
          return (record ?? null) as T | null;
        }
        throw new Error("Unexpected first() query in test database.");
      },
      run: async () => {
        if (/INSERT INTO integrations/i.test(sql)) {
          const [id, tenantId, provider, settings] = values as string[];
          const key = `${tenantId}:${provider}`;
          if (this.integrations.has(key)) return { meta: { changes: 0 } };
          this.integrations.set(key, {
            id,
            tenant_id: tenantId,
            provider,
            enabled: 1,
            settings,
            created_at: "synthetic",
            updated_at: "synthetic",
          });
          return { meta: { changes: 1 } };
        }
        if (/SET settings = \?, updated_at/i.test(sql)) {
          const [settings, tenantId, id, provider, expectedSettings] = values;
          const key = `${String(tenantId)}:${String(provider)}`;
          const record = this.integrations.get(key);
          if (!record || record.id !== id || record.settings !== expectedSettings) {
            return { meta: { changes: 0 } };
          }
          record.settings = String(settings);
          return { meta: { changes: 1 } };
        }
        if (/SET enabled = \?, updated_at/i.test(sql)) {
          const [enabled, tenantId, id, provider, expected] = values;
          const record = this.integrations.get(`${String(tenantId)}:${String(provider)}`);
          if (!record || record.id !== id || record.enabled !== expected) return { meta: { changes: 0 } };
          record.enabled = Number(enabled);
          return { meta: { changes: 1 } };
        }
        if (/SET enabled = 1, settings = \?/i.test(sql)) {
          const [settings, tenantId, id, provider, expectedSettings] = values;
          const record = this.integrations.get(`${String(tenantId)}:${String(provider)}`);
          if (!record || record.id !== id || record.enabled !== 0 || record.settings !== expectedSettings) {
            return { meta: { changes: 0 } };
          }
          record.enabled = 1;
          record.settings = String(settings);
          return { meta: { changes: 1 } };
        }
        throw new Error("Unexpected run() query in test database.");
      },
    };
    return statement;
  }
}

async function createApp() {
  const db = new ManagementDatabase();
  db.apiKeyHash = await hashApiKey("fl360_test_only");
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.route("/channel-manager/staah", staahRoutes);
  return { app, db };
}

function headers() {
  return { Authorization: "Bearer fl360_test_only", "Content-Type": "application/json" };
}

test("authenticated tenant can configure, inspect, and verify STAAH without GHL context", async () => {
  const { app, db } = await createApp();
  const configured = await app.request("/channel-manager/staah", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ syntheticPropertyId: "mock-property-a" }),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(configured.status, 200);
  const configuredBody = await configured.json() as {
    created: boolean;
    connection: {
      integrationId: string;
      status: string;
      liveStatus: string;
      connectionHealth: { state: string; configurationValid: boolean; mode: string; liveStatus: string };
      syncDiagnostics: { state: string; inProgress: boolean; retryEligibility: string };
    };
  };
  assert.equal(configuredBody.created, true);
  assert.equal(configuredBody.connection.status, "configured_not_verified");
  assert.equal(configuredBody.connection.liveStatus, "live_not_configured");
  assert.equal(configuredBody.connection.connectionHealth.state, "configured_not_verified");
  assert.equal(configuredBody.connection.connectionHealth.configurationValid, true);
  assert.equal(configuredBody.connection.connectionHealth.mode, "mock");
  assert.equal(configuredBody.connection.connectionHealth.liveStatus, "live_not_configured");
  assert.equal(configuredBody.connection.syncDiagnostics.retryEligibility, "connection_not_operational");
  assert.equal(JSON.stringify(configuredBody).includes("fl360_test_only"), false);
  const id = configuredBody.connection.integrationId;

  const inspected = await app.request(`/channel-manager/staah/${id}`, {
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(inspected.status, 200);

  const prematureSync = await app.request(`/channel-manager/staah/${id}/sync`, {
    method: "POST",
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(prematureSync.status, 409);
  assert.equal((await prematureSync.json() as { code: string }).code, "connection_unverified");

  const verified = await app.request(`/channel-manager/staah/${id}/verify`, {
    method: "POST",
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json() as { connection: { status: string } };
  assert.equal(verifiedBody.connection.status, "mock_verified");

  const verifiedInspection = await app.request(`/channel-manager/staah/${id}`, {
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  const verifiedInspectionBody = await verifiedInspection.json() as {
    connection: { connectionHealth: { state: string }; syncDiagnostics: { retryEligibility: string } };
  };
  assert.equal(verifiedInspectionBody.connection.connectionHealth.state, "mock_verified");
  assert.equal(verifiedInspectionBody.connection.syncDiagnostics.retryEligibility, "eligible");

  const property = await app.request(`/channel-manager/staah/${id}/property`, {
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(property.status, 200);
  const propertyBody = await property.json() as {
    property: { providerPropertyId: string };
    mappings: Array<{ tenantId: string; integrationId: string; provider: string }>;
    mappingDiagnostics: { status: string; persistedCount: number; expectedCount: number; missingCount: number; conflictingCount: number };
  };
  assert.equal(propertyBody.property.providerPropertyId, "mock-property-a");
  assert.equal(propertyBody.mappings.length, 5);
  assert.equal(propertyBody.mappings.every((mapping) =>
    mapping.tenantId === "tenant-a" && mapping.integrationId === id && mapping.provider === "staah"
  ), true);
  assert.deepEqual(propertyBody.mappingDiagnostics, {
    status: "not_persisted",
    persistedCount: 0,
    expectedCount: 5,
    missingCount: 5,
    conflictingCount: 0,
  });
});

test("invalid credentials and missing permission fail closed", async () => {
  const { app, db } = await createApp();
  const invalid = await app.request("/channel-manager/staah", { method: "GET" }, {
    DB: db as unknown as D1Database,
  } as AppBindings);
  assert.equal(invalid.status, 401);

  db.clientPermissions = ["integrations:read"];
  const denied = await app.request("/channel-manager/staah", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ syntheticPropertyId: "mock-property-a" }),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(denied.status, 403);
});

test("caller-supplied tenant IDs cannot inspect another tenant's integration", async () => {
  const { app, db } = await createApp();
  db.seed("tenant-b", "integration-b");
  const response = await app.request(
    "/channel-manager/staah/integration-b?tenantId=tenant-b",
    { headers: headers() },
    { DB: db as unknown as D1Database } as AppBindings,
  );
  assert.equal(response.status, 404);
  const update = await app.request("/channel-manager/staah/integration-b", {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ syntheticPropertyId: "mock-tamper" }),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(update.status, 404);
});

test("mock sync route requires write permission and remains tenant scoped", async () => {
  const { app, db } = await createApp();
  db.seed("tenant-a", "integration-a");
  db.clientPermissions = ["integrations:read"];
  const denied = await app.request("/channel-manager/staah/integration-a/sync", {
    method: "POST", headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(denied.status, 403);

  db.clientPermissions = ["integrations:read", "integrations:write"];
  const foreign = await app.request("/channel-manager/staah/integration-b/sync", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ tenantId: "tenant-b", integrationId: "integration-b" }),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(foreign.status, 404);
});

test("database failures return a sanitized unavailable response", async () => {
  const { app, db } = await createApp();
  db.failIntegrationReads = true;
  const response = await app.request("/channel-manager/staah", {
    headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), JSON.stringify({
    success: false,
    code: "persistence_failure",
    message: "STAAH connection operation is temporarily unavailable.",
  }));
});

test("duplicate creation is idempotent and re-enabling requires verification", async () => {
  const { app, db } = await createApp();
  const create = () => app.request("/channel-manager/staah", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ syntheticPropertyId: "mock-property-a" }),
  }, { DB: db as unknown as D1Database } as AppBindings);
  const first = await create();
  const firstBody = await first.json() as { connection: { integrationId: string } };
  const duplicate = await create();
  const duplicateBody = await duplicate.json() as { created: boolean; connection: { integrationId: string } };
  assert.equal(duplicateBody.created, false);
  assert.equal(duplicateBody.connection.integrationId, firstBody.connection.integrationId);

  await app.request(`/channel-manager/staah/${firstBody.connection.integrationId}/verify`, {
    method: "POST", headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  await app.request(`/channel-manager/staah/${firstBody.connection.integrationId}/disable`, {
    method: "POST", headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  const enabled = await app.request(`/channel-manager/staah/${firstBody.connection.integrationId}/enable`, {
    method: "POST", headers: headers(),
  }, { DB: db as unknown as D1Database } as AppBindings);
  const enabledBody = await enabled.json() as { connection: { status: string; lastResult: string } };
  assert.equal(enabledBody.connection.status, "configured_not_verified");
  assert.equal(enabledBody.connection.lastResult, "mock_verified");
});

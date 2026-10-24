import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationRecord } from "../../../../src/persistence/models/integration";
import { IntegrationRepository } from "../../../../src/persistence/repositories/integration-repository";
import {
  STAAHConnectionManagementService,
  STAAHManagementError,
  type STAAHSyncCheckpoint,
} from "../../../../src/integrations/channel-manager/staah/staah-management";

class MemoryIntegrationRepository extends IntegrationRepository {
  readonly rows = new Map<string, IntegrationRecord>();

  constructor() {
    super({} as D1Database);
  }

  override async findByTenantAndProvider(tenantId: string, provider: string) {
    return this.rows.get(`${tenantId}:${provider}`) ?? null;
  }

  override async createIfMissing(
    integration: Pick<IntegrationRecord, "id" | "tenant_id" | "provider" | "settings">,
  ) {
    const key = `${integration.tenant_id}:${integration.provider}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, {
      ...integration,
      enabled: 1,
      created_at: "synthetic",
      updated_at: "synthetic",
    });
    return true;
  }

  override async updateTenantProviderSettings(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedSettings: string | null,
    settings: string,
  ) {
    const key = `${tenantId}:${provider}`;
    const record = this.rows.get(key);
    if (!record || record.id !== integrationId || record.settings !== expectedSettings) return false;
    this.rows.set(key, { ...record, settings });
    return true;
  }

  override async setTenantProviderEnabled(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedEnabled: boolean,
    enabled: boolean,
  ) {
    const key = `${tenantId}:${provider}`;
    const record = this.rows.get(key);
    if (!record || record.id !== integrationId || (record.enabled === 1) !== expectedEnabled) return false;
    this.rows.set(key, { ...record, enabled: enabled ? 1 : 0 });
    return true;
  }

  override async reenableTenantProviderUnverified(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedSettings: string | null,
    settings: string,
  ) {
    const key = `${tenantId}:${provider}`;
    const record = this.rows.get(key);
    if (!record || record.id !== integrationId || record.enabled !== 0 || record.settings !== expectedSettings) return false;
    this.rows.set(key, { ...record, enabled: 1, settings });
    return true;
  }
}

function createService(repository = new MemoryIntegrationRepository()) {
  return {
    repository,
    service: new STAAHConnectionManagementService({} as D1Database, repository),
  };
}

const config = { syntheticPropertyId: "mock-property-alpha" };

function requireIntegrationId(id: string | null): string {
  if (!id) throw new Error("Expected a persisted integration ID.");
  return id;
}

test("persists tenant-scoped mock configuration and loads it in a new service instance", async () => {
  const repository = new MemoryIntegrationRepository();
  const firstService = createService(repository).service;
  const created = await firstService.configure("tenant-a", config);
  assert.equal(created.created, true);
  assert.equal(created.connection.status, "configured_not_verified");
  assert.equal(created.connection.provider, "staah");
  assert.equal(created.connection.mode, "mock");
  assert.equal(created.connection.profile, "crm");
  assert.equal(created.connection.syntheticPropertyId, config.syntheticPropertyId);
  assert.equal(created.connection.liveStatus, "live_not_configured");

  const nextRequestService = createService(repository).service;
  const loaded = await nextRequestService.inspect("tenant-a", requireIntegrationId(created.connection.integrationId));
  assert.deepEqual(loaded, created.connection);
  assert.equal(repository.rows.get("tenant-a:staah")?.settings?.includes("credential"), false);
});

test("concurrent configuration creates only one tenant/provider integration", async () => {
  const { service, repository } = createService();
  const results = await Promise.all([
    service.configure("tenant-a", config),
    service.configure("tenant-a", config),
  ]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.connection.integrationId)).size, 1);
  assert.equal(repository.rows.size, 1);
});

test("rejects live mode, non-CRM profile, and caller-supplied ownership", async () => {
  const { service } = createService();
  for (const input of [
    { ...config, mode: "live" },
    { ...config, profile: "rms" },
    { ...config, tenantId: "tenant-b" },
    { ...config, provider: "gohighlevel" },
  ]) {
    await assert.rejects(service.configure("tenant-a", input), STAAHManagementError);
  }
  await assert.rejects(
    service.configure("tenant-a", { syntheticPropertyId: "real-property-id" }),
    (error: unknown) => error instanceof STAAHManagementError && error.status === 400,
  );
});

test("configuration changes invalidate mock verification while preserving settings", async () => {
  const { service } = createService();
  const created = await service.configure("tenant-a", config);
  const id = requireIntegrationId(created.connection.integrationId);
  const verified = await service.verify("tenant-a", id);
  assert.equal(verified.status, "mock_verified");
  const updated = await service.update("tenant-a", id, {
    syntheticPropertyId: "mock-property-beta",
  });
  assert.equal(updated.status, "configured_not_verified");
  assert.equal(updated.syntheticPropertyId, "mock-property-beta");
  assert.equal(updated.lastResult, "mock_verified");
  assert.ok(updated.lastAttemptAt);
});

test("persists successful and failed mock verification without outbound requests", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network disabled in test");
  }) as typeof fetch;
  try {
    const { service } = createService();
    const created = await service.configure("tenant-a", config);
    const verified = await service.verify("tenant-a", requireIntegrationId(created.connection.integrationId));
    assert.equal(verified.status, "mock_verified");
    assert.equal(verified.lastResult, "mock_verified");

    const failing = await service.configure("tenant-b", {
      ...config,
      simulateVerificationFailure: true,
    });
    const failed = await service.verify("tenant-b", requireIntegrationId(failing.connection.integrationId));
    assert.equal(failed.status, "mock_verification_failed");
    assert.equal(failed.lastResult, "mock_failed");
    assert.equal(failed.reason, "simulated_provider_failure");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tenant and integration identity are enforced for reads, updates, and verification", async () => {
  const { service } = createService();
  const created = await service.configure("tenant-a", config);
  const id = requireIntegrationId(created.connection.integrationId);
  await assert.rejects(
    service.inspect("tenant-b", id),
    (error: unknown) => error instanceof STAAHManagementError && error.status === 404,
  );
  await assert.rejects(
    service.update("tenant-b", id, config),
    STAAHManagementError,
  );
  await assert.rejects(
    service.verify("tenant-a", "another-integration"),
    STAAHManagementError,
  );
});

test("disable preserves settings and re-enable requires fresh verification", async () => {
  const { service, repository } = createService();
  const created = await service.configure("tenant-a", config);
  const id = requireIntegrationId(created.connection.integrationId);
  const verified = await service.verify("tenant-a", id);
  const disabled = await service.disable("tenant-a", id);
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.lastResult, "mock_verified");
  await assert.rejects(
    service.verify("tenant-a", id),
    (error: unknown) => error instanceof STAAHManagementError && error.status === 409,
  );
  const reenabled = await service.enable("tenant-a", id);
  assert.equal(reenabled.status, "configured_not_verified");
  assert.equal(reenabled.lastResult, "mock_verified");
  const refreshed = await service.verify("tenant-a", id);
  assert.equal(refreshed.status, "mock_verified");
  assert.equal(repository.rows.get("tenant-a:staah")?.enabled, 1);
  assert.equal(verified.status, "mock_verified");
});

test("inspect reports a clear unconfigured and live-not-configured state", async () => {
  const { service } = createService();
  const result = await service.inspect("tenant-a");
  assert.equal(result.status, "not_configured");
  assert.equal(result.liveStatus, "live_not_configured");
  assert.equal(result.connectionHealth.configurationValid, false);
  assert.equal(result.syncDiagnostics.state, "idle");
  assert.equal(result.syncDiagnostics.retryEligibility, "connection_not_operational");
});

test("connection and latest-sync diagnostics remain independent and expose only persisted checkpoint facts", async () => {
  const { service, repository } = createService();
  const created = await service.configure("tenant-a", config);
  const id = requireIntegrationId(created.connection.integrationId);
  assert.equal(created.connection.connectionHealth.state, "configured_not_verified");
  assert.equal(created.connection.syncDiagnostics.retryEligibility, "connection_not_operational");

  await service.verify("tenant-a", id);
  const record = repository.rows.get("tenant-a:staah");
  assert.ok(record?.settings);
  const settings = JSON.parse(record.settings) as {
    syncCheckpoint: STAAHSyncCheckpoint;
  };
  settings.syncCheckpoint = {
    status: "failed",
    attemptId: "safe-attempt-id",
    startedAt: "2030-01-01T00:00:00.000Z",
    leaseExpiresAt: null,
    completedAt: "2030-01-01T00:01:00.000Z",
    processedCount: 2,
    insertedCount: 1,
    updatedCount: 0,
    unchangedCount: 1,
    rejectedCount: 0,
    lastErrorCode: "reservation_revision_conflict",
  };
  record.settings = JSON.stringify(settings);

  const inspected = await service.inspect("tenant-a", id);
  assert.equal(inspected.connectionHealth.state, "mock_verified");
  assert.equal(inspected.syncDiagnostics.state, "failed");
  assert.equal(inspected.syncDiagnostics.lastFailedSyncAt, "2030-01-01T00:01:00.000Z");
  assert.equal(inspected.syncDiagnostics.lastSuccessfulSyncAt, null);
  assert.equal(inspected.syncDiagnostics.lastErrorCode, "reservation_revision_conflict");
  assert.equal(inspected.syncDiagnostics.retryEligibility, "eligible");

  const disabled = await service.disable("tenant-a", id);
  assert.equal(disabled.connectionHealth.state, "disabled");
  assert.equal(disabled.syncDiagnostics.state, "failed");
  assert.equal(disabled.syncDiagnostics.retryEligibility, "connection_not_operational");
  assert.equal(disabled.connectionHealth.liveStatus, "live_not_configured");
});

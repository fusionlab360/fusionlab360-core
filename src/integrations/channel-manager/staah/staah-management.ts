import { IntegrationRepository } from "../../../persistence/repositories/integration-repository";
import type { IntegrationRecord } from "../../../persistence/models/integration";
import { resolveSTAAHAdapter } from "./";
import type {
  STAAHConnectionContext,
  STAAHMockFailureScenario,
  STAAHResourceMapping,
} from "./contracts";

const PROVIDER = "staah";
const SYNTHETIC_PROPERTY_ID = /^mock-[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
type VerificationReason =
  | "simulated_provider_failure"
  | "configuration_invalid"
  | "configuration"
  | "unsupported"
  | "provider_unavailable"
  | "timeout"
  | "partial_processing"
  | "unknown";

type MockStatus =
  | "configured_not_verified"
  | "mock_verified"
  | "mock_verification_failed";

interface STAAHSettings extends Record<string, unknown> {
  providerConfiguration: {
    category: "channel_manager";
    mode: "mock";
    profile: "crm";
    syntheticPropertyId: string;
    simulateVerificationFailure: boolean;
    mockFailureScenario: STAAHMockFailureScenario;
  };
  verification: {
    currentStatus: MockStatus;
    lastAttemptAt: string | null;
    lastResult: "mock_verified" | "mock_failed" | null;
    reason: VerificationReason | null;
  };
  resourceMappings: STAAHResourceMapping[];
  syncCheckpoint: STAAHSyncCheckpoint;
}

export interface STAAHSyncCheckpoint {
  status: "idle" | "running" | "succeeded" | "failed";
  attemptId: string | null;
  startedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  lastErrorCode: "provider_unavailable" | "timeout" | "partial_processing" | "configuration" | "invalid_reservation" | "reservation_revision_conflict" | "persistence_failure" | "internal" | null;
}

export interface STAAHSyncDiagnostics {
  state: STAAHSyncCheckpoint["status"];
  lastAttemptStartedAt: string | null;
  lastAttemptCompletedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  counts: Pick<STAAHSyncCheckpoint,
    "processedCount" | "insertedCount" | "updatedCount" | "unchangedCount" | "rejectedCount">;
  lastErrorCode: STAAHSyncCheckpoint["lastErrorCode"];
  inProgress: boolean;
  retryEligibility: "eligible" | "connection_not_operational" | "active_sync";
}

export interface STAAHConnectionHealth {
  state: STAAHConnectionView["status"];
  configured: boolean;
  enabled: boolean;
  configurationValid: boolean;
  mode: "mock";
  liveStatus: "live_not_configured";
  verification: {
    state: MockStatus | "not_configured";
    lastAttemptAt: string | null;
    result: "mock_verified" | "mock_failed" | null;
    errorCode: VerificationReason | null;
  };
}

export interface STAAHOperationalConnection {
  record: IntegrationRecord;
  context: STAAHConnectionContext;
  syntheticPropertyId: string;
  mockFailureScenario: STAAHMockFailureScenario;
  resourceMappings: STAAHResourceMapping[];
  syncCheckpoint: STAAHSyncCheckpoint;
}

const EMPTY_CHECKPOINT: STAAHSyncCheckpoint = {
  status: "idle",
  attemptId: null,
  startedAt: null,
  leaseExpiresAt: null,
  completedAt: null,
  processedCount: 0,
  insertedCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  rejectedCount: 0,
  lastErrorCode: null,
};

export interface STAAHConnectionView {
  provider: "staah";
  tenantId: string;
  integrationId: string | null;
  enabled: boolean;
  status: "not_configured" | "configured_not_verified" | "mock_verified" |
    "mock_verification_failed" | "disabled";
  mode: "mock";
  profile: "crm";
  category: "channel_manager";
  syntheticPropertyId?: string;
  lastAttemptAt?: string | null;
  lastResult?: "mock_verified" | "mock_failed" | null;
  reason?: VerificationReason | null;
  syncCheckpoint?: STAAHSyncCheckpoint;
  connectionHealth: STAAHConnectionHealth;
  syncDiagnostics: STAAHSyncDiagnostics;
  liveStatus: "live_not_configured";
}

export class STAAHManagementError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
    readonly code: "invalid_configuration" | "invalid_mapping" | "invalid_checkpoint" |
      "connection_not_found" | "connection_disabled" | "connection_unverified" |
      "state_conflict" | "persistence_failure" = status === 400
        ? "invalid_configuration"
        : status === 404
          ? "connection_not_found"
          : status === 503
            ? "persistence_failure"
            : "state_conflict",
  ) {
    super(message);
    this.name = "STAAHManagementError";
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseSettings(record: IntegrationRecord): STAAHSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.settings ?? "{}");
  } catch {
    throw new STAAHManagementError(409, "Stored STAAH configuration is invalid.", "invalid_configuration");
  }
  const root = objectRecord(parsed);
  const configuration = objectRecord(root?.providerConfiguration);
  const verification = objectRecord(root?.verification);
  const mockFailureScenario = configuration?.mockFailureScenario ?? "none";
  if (
    configuration?.category !== "channel_manager" ||
    configuration.mode !== "mock" ||
    configuration.profile !== "crm" ||
    typeof configuration.syntheticPropertyId !== "string" ||
    !SYNTHETIC_PROPERTY_ID.test(configuration.syntheticPropertyId) ||
    typeof configuration.simulateVerificationFailure !== "boolean" ||
    !["none", "provider_unavailable", "timeout", "partial_batch_failure"].includes(String(mockFailureScenario)) ||
    !verification ||
    !["configured_not_verified", "mock_verified", "mock_verification_failed"]
      .includes(String(verification.currentStatus)) ||
    !(verification.lastAttemptAt === null || typeof verification.lastAttemptAt === "string") ||
    !(verification.lastResult === null || ["mock_verified", "mock_failed"].includes(String(verification.lastResult))) ||
    !(verification.reason === null || [
      "simulated_provider_failure",
      "configuration_invalid",
      "configuration",
      "unsupported",
      "provider_unavailable",
      "timeout",
      "partial_processing",
      "unknown",
    ].includes(String(verification.reason)))
  ) {
    throw new STAAHManagementError(409, "Stored STAAH configuration is invalid.", "invalid_configuration");
  }

  const rawMappings = root?.resourceMappings;
  const resourceMappings = rawMappings === undefined
    ? []
    : Array.isArray(rawMappings)
      ? rawMappings as STAAHResourceMapping[]
      : null;
  if (!resourceMappings || resourceMappings.some((mapping) =>
    !mapping ||
    mapping.tenantId !== record.tenant_id ||
    mapping.integrationId !== record.id ||
    mapping.provider !== PROVIDER ||
    mapping.providerPropertyId !== configuration.syntheticPropertyId ||
    !["property", "room", "rate_plan"].includes(mapping.resourceType) ||
    typeof mapping.providerResourceId !== "string" || !mapping.providerResourceId.trim() ||
    typeof mapping.canonicalResourceId !== "string" || !mapping.canonicalResourceId.trim()
  )) {
    throw new STAAHManagementError(409, "Stored STAAH resource mappings are invalid.", "invalid_mapping");
  }

  const rawCheckpoint = objectRecord(root?.syncCheckpoint);
  if (root?.syncCheckpoint !== undefined && !rawCheckpoint) {
    throw new STAAHManagementError(409, "Stored STAAH synchronization checkpoint is invalid.", "invalid_checkpoint");
  }
  let syncCheckpoint: STAAHSyncCheckpoint = { ...EMPTY_CHECKPOINT };
  if (rawCheckpoint) {
    const countFields = ["processedCount", "insertedCount", "updatedCount", "unchangedCount", "rejectedCount"] as const;
    if (
      !["idle", "running", "succeeded", "failed"].includes(String(rawCheckpoint.status)) ||
      !(rawCheckpoint.attemptId === null || typeof rawCheckpoint.attemptId === "string") ||
      !(rawCheckpoint.startedAt === null || typeof rawCheckpoint.startedAt === "string") ||
      !(rawCheckpoint.leaseExpiresAt === null || typeof rawCheckpoint.leaseExpiresAt === "string") ||
      !(rawCheckpoint.completedAt === null || typeof rawCheckpoint.completedAt === "string") ||
      countFields.some((field) => !Number.isSafeInteger(rawCheckpoint[field]) || Number(rawCheckpoint[field]) < 0) ||
      !(rawCheckpoint.lastErrorCode === null || ["provider_unavailable", "timeout", "partial_processing", "configuration", "invalid_reservation", "reservation_revision_conflict", "persistence_failure", "internal"].includes(String(rawCheckpoint.lastErrorCode)))
      || (rawCheckpoint.status === "running" &&
        (typeof rawCheckpoint.attemptId !== "string" || !rawCheckpoint.attemptId ||
          typeof rawCheckpoint.startedAt !== "string" || !rawCheckpoint.startedAt ||
          typeof rawCheckpoint.leaseExpiresAt !== "string" || !rawCheckpoint.leaseExpiresAt))
    ) {
      throw new STAAHManagementError(409, "Stored STAAH synchronization checkpoint is invalid.", "invalid_checkpoint");
    }
    syncCheckpoint = rawCheckpoint as unknown as STAAHSyncCheckpoint;
  }

  return {
    ...root,
    providerConfiguration: {
      category: "channel_manager",
      mode: "mock",
      profile: "crm",
      syntheticPropertyId: configuration.syntheticPropertyId,
      simulateVerificationFailure: configuration.simulateVerificationFailure,
      mockFailureScenario: mockFailureScenario as STAAHMockFailureScenario,
    },
    verification: {
      currentStatus: verification.currentStatus as MockStatus,
      lastAttemptAt: verification.lastAttemptAt as string | null,
      lastResult: verification.lastResult as "mock_verified" | "mock_failed" | null,
      reason: verification.reason as VerificationReason | null,
    },
    resourceMappings,
    syncCheckpoint,
  };
}

function serialize(settings: STAAHSettings): string {
  return JSON.stringify(settings);
}

function view(record: IntegrationRecord | null, tenantId: string): STAAHConnectionView {
  if (!record) {
    return {
      provider: "staah",
      tenantId,
      integrationId: null,
      enabled: false,
      status: "not_configured",
      mode: "mock",
      profile: "crm",
      category: "channel_manager",
      connectionHealth: {
        state: "not_configured",
        configured: false,
        enabled: false,
        configurationValid: false,
        mode: "mock",
        liveStatus: "live_not_configured",
        verification: {
          state: "not_configured",
          lastAttemptAt: null,
          result: null,
          errorCode: null,
        },
      },
      syncDiagnostics: syncDiagnostics(EMPTY_CHECKPOINT, false, false),
      liveStatus: "live_not_configured",
    };
  }

  const settings = parseSettings(record);
  const enabled = record.enabled === 1;
  const status = enabled ? settings.verification.currentStatus : "disabled";
  return {
    provider: "staah",
    tenantId,
    integrationId: record.id,
    enabled,
    status,
    mode: "mock",
    profile: "crm",
    category: "channel_manager",
    syntheticPropertyId: settings.providerConfiguration.syntheticPropertyId,
    lastAttemptAt: settings.verification.lastAttemptAt,
    lastResult: settings.verification.lastResult,
    reason: settings.verification.reason,
    syncCheckpoint: settings.syncCheckpoint,
    connectionHealth: {
      state: status,
      configured: true,
      enabled,
      configurationValid: true,
      mode: "mock",
      liveStatus: "live_not_configured",
      verification: {
        state: settings.verification.currentStatus,
        lastAttemptAt: settings.verification.lastAttemptAt,
        result: settings.verification.lastResult,
        errorCode: settings.verification.reason,
      },
    },
    syncDiagnostics: syncDiagnostics(
      settings.syncCheckpoint,
      enabled,
      enabled && settings.verification.currentStatus === "mock_verified",
    ),
    liveStatus: "live_not_configured",
  };
}

function syncDiagnostics(
  checkpoint: STAAHSyncCheckpoint,
  enabled: boolean,
  verified: boolean,
  now = Date.now(),
): STAAHSyncDiagnostics {
  const inProgress = checkpoint.status === "running" &&
    checkpoint.leaseExpiresAt !== null &&
    Date.parse(checkpoint.leaseExpiresAt) > now;
  return {
    state: checkpoint.status,
    lastAttemptStartedAt: checkpoint.startedAt,
    lastAttemptCompletedAt: checkpoint.completedAt,
    // The checkpoint retains only the latest attempt. These timestamps are
    // populated only when that latest attempt has the corresponding outcome.
    lastSuccessfulSyncAt: checkpoint.status === "succeeded" ? checkpoint.completedAt : null,
    lastFailedSyncAt: checkpoint.status === "failed" ? checkpoint.completedAt : null,
    counts: {
      processedCount: checkpoint.processedCount,
      insertedCount: checkpoint.insertedCount,
      updatedCount: checkpoint.updatedCount,
      unchangedCount: checkpoint.unchangedCount,
      rejectedCount: checkpoint.rejectedCount,
    },
    lastErrorCode: checkpoint.lastErrorCode,
    inProgress,
    retryEligibility: !enabled || !verified
      ? "connection_not_operational"
      : inProgress
        ? "active_sync"
        : "eligible",
  };
}

function readRequestedConfiguration(input: unknown): {
  syntheticPropertyId: string;
  simulateVerificationFailure: boolean;
  mockFailureScenario: STAAHMockFailureScenario;
} {
  const body = objectRecord(input);
  if (!body || Object.keys(body).some((key) => ![
    "syntheticPropertyId",
    "simulateVerificationFailure",
    "mockFailureScenario",
    "mode",
    "profile",
    "category",
    "provider",
    "tenantId",
    "integrationId",
  ].includes(key))) {
    throw new STAAHManagementError(400, "STAAH configuration contains unsupported fields.");
  }
  const syntheticPropertyId = body?.syntheticPropertyId;
  const simulateVerificationFailure = body?.simulateVerificationFailure ?? false;
  const mockFailureScenario = body?.mockFailureScenario ?? "none";
  if (
    (body?.mode !== undefined && body.mode !== "mock") ||
    (body?.profile !== undefined && body.profile !== "crm") ||
    (body?.category !== undefined && body.category !== "channel_manager") ||
    (body?.provider !== undefined && body.provider !== PROVIDER) ||
    body?.tenantId !== undefined ||
    body?.integrationId !== undefined
  ) {
    throw new STAAHManagementError(
      400,
      "STAAH ownership is fixed to the authenticated tenant, mock mode, and CRM profile.",
    );
  }
  if (
    typeof syntheticPropertyId !== "string" ||
    !SYNTHETIC_PROPERTY_ID.test(syntheticPropertyId) ||
    typeof simulateVerificationFailure !== "boolean" ||
    !["none", "provider_unavailable", "timeout", "partial_batch_failure"].includes(String(mockFailureScenario))
  ) {
    throw new STAAHManagementError(
      400,
      "A syntheticPropertyId beginning with 'mock-' and an optional boolean simulateVerificationFailure are required.",
    );
  }
  return {
    syntheticPropertyId,
    simulateVerificationFailure,
    mockFailureScenario: mockFailureScenario as STAAHMockFailureScenario,
  };
}

function newSettings(
  input: ReturnType<typeof readRequestedConfiguration>,
): STAAHSettings {
  return {
    providerConfiguration: {
      category: "channel_manager",
      mode: "mock",
      profile: "crm",
      ...input,
    },
    verification: {
      currentStatus: "configured_not_verified",
      lastAttemptAt: null,
      lastResult: null,
      reason: null,
    },
    resourceMappings: [],
    syncCheckpoint: { ...EMPTY_CHECKPOINT },
  };
}

function updatedSettings(
  current: STAAHSettings,
  input: ReturnType<typeof readRequestedConfiguration>,
): STAAHSettings {
  const propertyChanged = input.syntheticPropertyId !== current.providerConfiguration.syntheticPropertyId;
  return {
    ...current,
    providerConfiguration: {
      category: "channel_manager",
      mode: "mock",
      profile: "crm",
      ...input,
    },
    verification: {
      ...current.verification,
      currentStatus: "configured_not_verified",
      reason: null,
    },
    resourceMappings: input.syntheticPropertyId === current.providerConfiguration.syntheticPropertyId
      ? current.resourceMappings
      : [],
    // Scenario/configuration changes must not erase a failed attempt that an
    // operator needs to inspect or recover. A different property has a
    // different identity and cannot reuse the prior property's checkpoint.
    syncCheckpoint: propertyChanged ? { ...EMPTY_CHECKPOINT } : current.syncCheckpoint,
  };
}

export class STAAHConnectionManagementService {
  private readonly repository: IntegrationRepository;

  constructor(
    db: D1Database,
    repository = new IntegrationRepository(db),
  ) {
    this.repository = repository;
  }

  async inspect(tenantId: string, integrationId?: string): Promise<STAAHConnectionView> {
    const record = await this.repository.findByTenantAndProvider(tenantId, PROVIDER);
    if (integrationId && (!record || record.id !== integrationId)) {
      throw new STAAHManagementError(404, "STAAH connection was not found.");
    }
    return view(record, tenantId);
  }

  async configure(
    tenantId: string,
    input: unknown,
  ): Promise<{ connection: STAAHConnectionView; created: boolean }> {
    const requested = readRequestedConfiguration(input);
    const existing = await this.repository.findByTenantAndProvider(tenantId, PROVIDER);
    if (existing) {
      return { connection: view(existing, tenantId), created: false };
    }

    const id = crypto.randomUUID();
    const settings = newSettings(requested);
    const created = await this.repository.createIfMissing({
      id,
      tenant_id: tenantId,
      provider: PROVIDER,
      settings: serialize(settings),
    });
    const record = await this.repository.findByTenantAndProvider(tenantId, PROVIDER);
    if (!record) {
      throw new STAAHManagementError(503, "STAAH configuration could not be loaded.");
    }
    return { connection: view(record, tenantId), created };
  }

  async update(
    tenantId: string,
    integrationId: string,
    input: unknown,
  ): Promise<STAAHConnectionView> {
    const requested = readRequestedConfiguration(input);
    const record = await this.getRecord(tenantId, integrationId);
    const current = parseSettings(record);
    if (
      current.syncCheckpoint.status === "running" &&
      current.syncCheckpoint.leaseExpiresAt !== null &&
      Date.parse(current.syncCheckpoint.leaseExpiresAt) > Date.now()
    ) {
      throw new STAAHManagementError(409, "STAAH configuration cannot change during an active synchronization.", "state_conflict");
    }
    const next = updatedSettings(current, requested);
    const updated = await this.repository.updateTenantProviderSettings(
      tenantId,
      integrationId,
      PROVIDER,
      record.settings,
      serialize(next),
    );
    if (!updated) {
      throw new STAAHManagementError(409, "STAAH configuration changed concurrently; inspect and retry.");
    }
    return view({ ...record, settings: serialize(next) }, tenantId);
  }

  async verify(tenantId: string, integrationId: string): Promise<STAAHConnectionView> {
    const record = await this.getRecord(tenantId, integrationId);
    if (record.enabled !== 1) {
      throw new STAAHManagementError(409, "Disabled STAAH connections cannot be verified.", "connection_disabled");
    }
    const settings = parseSettings(record);
    const context = {
      tenantId,
      integrationId: record.id,
      connectionId: record.id,
    };
    const adapter = resolveSTAAHAdapter(context, settings.providerConfiguration);
    let resultStatus: "mock_verified" | "mock_failed";
    let failureReason: VerificationReason | null = null;
    try {
      const result = await adapter.verifyConnection(context);
      resultStatus = result.status;
      failureReason = result.reason ?? null;
    } catch (error: unknown) {
      resultStatus = "mock_failed";
      failureReason = adapter.classifyError(error).category;
    }
    const checkedAt = new Date().toISOString();
    const next: STAAHSettings = {
      ...settings,
      verification: {
        currentStatus: resultStatus === "mock_verified"
          ? "mock_verified"
          : "mock_verification_failed",
        lastAttemptAt: checkedAt,
        lastResult: resultStatus,
        reason: failureReason,
      },
    };
    const updated = await this.repository.updateTenantProviderSettings(
      tenantId,
      integrationId,
      PROVIDER,
      record.settings,
      serialize(next),
    );
    if (!updated) {
      throw new STAAHManagementError(409, "STAAH configuration changed during verification; verify again.");
    }
    return view({ ...record, settings: serialize(next) }, tenantId);
  }

  async loadOperationalConnection(
    tenantId: string,
    integrationId: string,
  ): Promise<STAAHOperationalConnection> {
    const record = await this.getRecord(tenantId, integrationId);
    if (record.enabled !== 1) {
      throw new STAAHManagementError(409, "Disabled STAAH connections cannot synchronize.", "connection_disabled");
    }
    const settings = parseSettings(record);
    if (settings.verification.currentStatus !== "mock_verified") {
      throw new STAAHManagementError(409, "STAAH mock connection must be verified before synchronization.", "connection_unverified");
    }
    return {
      record,
      context: { tenantId, integrationId: record.id, connectionId: record.id },
      syntheticPropertyId: settings.providerConfiguration.syntheticPropertyId,
      mockFailureScenario: settings.providerConfiguration.mockFailureScenario,
      resourceMappings: settings.resourceMappings,
      syncCheckpoint: settings.syncCheckpoint,
    };
  }

  async updateSyncState(
    tenantId: string,
    integrationId: string,
    expectedSettings: string | null,
    syncCheckpoint: STAAHSyncCheckpoint,
    resourceMappings?: STAAHResourceMapping[],
  ): Promise<boolean> {
    const record = await this.getRecord(tenantId, integrationId);
    if (record.settings !== expectedSettings) return false;
    const current = parseSettings(record);
    const next: STAAHSettings = {
      ...current,
      syncCheckpoint,
      ...(resourceMappings === undefined ? {} : { resourceMappings }),
    };
    return this.repository.updateTenantProviderSettings(
      tenantId,
      integrationId,
      PROVIDER,
      expectedSettings,
      serialize(next),
    );
  }

  async disable(tenantId: string, integrationId: string): Promise<STAAHConnectionView> {
    const record = await this.getRecord(tenantId, integrationId);
    let responseRecord = record;
    if (record.enabled === 1) {
      const settings = parseSettings(record);
      if (settings.syncCheckpoint.status === "running") {
        const invalidated: STAAHSettings = {
          ...settings,
          syncCheckpoint: {
            ...settings.syncCheckpoint,
            status: "failed",
            leaseExpiresAt: null,
            completedAt: new Date().toISOString(),
            lastErrorCode: "configuration",
          },
        };
        const checkpointUpdated = await this.repository.updateTenantProviderSettings(
          tenantId,
          integrationId,
          PROVIDER,
          record.settings,
          serialize(invalidated),
        );
        if (!checkpointUpdated) {
          throw new STAAHManagementError(409, "STAAH synchronization changed concurrently; inspect and retry.");
        }
        responseRecord = { ...record, settings: serialize(invalidated) };
      }
      const updated = await this.repository.setTenantProviderEnabled(
        tenantId, integrationId, PROVIDER, true, false,
      );
      if (!updated) {
        throw new STAAHManagementError(409, "STAAH connection state changed concurrently; inspect and retry.");
      }
    }
    return view({ ...responseRecord, enabled: 0 }, tenantId);
  }

  async enable(tenantId: string, integrationId: string): Promise<STAAHConnectionView> {
    const record = await this.getRecord(tenantId, integrationId);
    if (record.enabled === 0) {
      const settings = parseSettings(record);
      const next: STAAHSettings = {
        ...settings,
        syncCheckpoint: settings.syncCheckpoint.status === "running"
          ? { ...EMPTY_CHECKPOINT }
          : settings.syncCheckpoint,
        verification: {
          ...settings.verification,
          currentStatus: "configured_not_verified",
          reason: null,
        },
      };
      const changed = await this.repository.reenableTenantProviderUnverified(
        tenantId,
        integrationId,
        PROVIDER,
        record.settings,
        serialize(next),
      );
      if (!changed) {
        throw new STAAHManagementError(409, "STAAH connection state changed concurrently; inspect and retry.");
      }
      return view({ ...record, enabled: 1, settings: serialize(next) }, tenantId);
    }
    return view(record, tenantId);
  }

  private async getRecord(tenantId: string, integrationId: string): Promise<IntegrationRecord> {
    const record = await this.repository.findByTenantAndProvider(tenantId, PROVIDER);
    if (!record || record.id !== integrationId) {
      throw new STAAHManagementError(404, "STAAH connection was not found.");
    }
    return record;
  }
}

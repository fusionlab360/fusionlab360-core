import type { ReservationPayload } from "../../../domain/reservation/types";
import type { ReservationLifecycle } from "../../../domain/reservation/lifecycle";
import type { ReservationIntegrationEventConsumer } from "../../../domain/reservation/integration-event-consumer";
import type { GHLInboundQueueEnvelope } from "../../../domain/messaging/inbound-queue-contract";
import { createCanonicalReservationId } from "../../../canonical/reservation";
import { ReservationRecordRepository } from "../../../persistence/repositories/reservation-record-repository";
import { resolveSTAAHAdapter, STAAHAdapterError } from "./";
import {
  buildDefaultSTAAHResourceMappings,
  normalizeSTAAHReservation,
  STAAHReservationNormalizationError,
} from "./normalization";
import type {
  STAAHMockProperty,
  STAAHResourceMapping,
} from "./contracts";
import {
  STAAHConnectionManagementService,
  STAAHManagementError,
  type STAAHOperationalConnection,
  type STAAHSyncCheckpoint,
} from "./staah-management";

const CHECKPOINT_LEASE_MS = 5 * 60 * 1000;

export class STAAHSyncError extends Error {
  constructor(
    readonly status: 404 | 409 | 503,
    message: string,
    readonly code: "connection_not_found" | "connection_disabled" | "connection_unverified" |
      "mapping_invalid" | "sync_already_running" | "sync_lease_conflict" |
      "reservation_revision_conflict" | "provider_unavailable" | "timeout" |
      "partial_processing" | "persistence_failure" | "sync_failed" = status === 404
        ? "connection_not_found"
        : status === 503
          ? "sync_failed"
          : "sync_lease_conflict",
  ) {
    super(message);
    this.name = "STAAHSyncError";
  }
}

class STAAHReservationRevisionConflictError extends STAAHSyncError {
  constructor() {
    super(409, "A reservation revision conflict must be resolved before synchronization can complete.", "reservation_revision_conflict");
    this.name = "STAAHReservationRevisionConflictError";
  }
}

class STAAHReservationPersistenceError extends Error {
  constructor() {
    super("Canonical reservation persistence failed.");
    this.name = "STAAHReservationPersistenceError";
  }
}

export interface STAAHSyncResult {
  provider: "staah";
  mode: "mock";
  tenantId: string;
  integrationId: string;
  propertyId: string;
  checkpoint: STAAHSyncCheckpoint;
  counts: Pick<STAAHSyncCheckpoint,
    "processedCount" | "insertedCount" | "updatedCount" | "unchangedCount" | "rejectedCount">;
}

function lifecycleOf(reservation: ReservationPayload): ReservationLifecycle {
  return reservation.status === "CANCELLED" ? "cancelled" : "confirmed";
}

function sameMappings(
  actual: readonly STAAHResourceMapping[],
  expected: readonly STAAHResourceMapping[],
): boolean {
  const signature = (mapping: STAAHResourceMapping) => [
    mapping.tenantId,
    mapping.integrationId,
    mapping.provider,
    mapping.providerPropertyId,
    mapping.resourceType,
    mapping.providerResourceId,
    mapping.canonicalResourceId,
  ].join("\u0000");
  return actual.length === expected.length &&
    [...actual].map(signature).sort().every((value, index) => value === [...expected].map(signature).sort()[index]);
}

function emptyCheckpoint(attemptId: string, now: string): STAAHSyncCheckpoint {
  return {
    status: "running",
    attemptId,
    startedAt: now,
    leaseExpiresAt: new Date(Date.parse(now) + CHECKPOINT_LEASE_MS).toISOString(),
    completedAt: null,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    rejectedCount: 0,
    lastErrorCode: null,
  };
}

function errorCode(error: unknown): STAAHSyncCheckpoint["lastErrorCode"] {
  if (error instanceof STAAHReservationRevisionConflictError) {
    return "reservation_revision_conflict";
  }
  if (error instanceof STAAHReservationPersistenceError) return "persistence_failure";
  if (error instanceof STAAHSyncError) {
    if (error.code === "provider_unavailable" || error.code === "timeout" || error.code === "partial_processing") {
      return error.code;
    }
    if (error.code === "mapping_invalid") return "configuration";
    return "internal";
  }
  if (error instanceof STAAHReservationNormalizationError) {
    return error.reason === "invalid_reservation" ? "invalid_reservation" : "configuration";
  }
  const adapterCode = error instanceof STAAHAdapterError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (adapterCode) {
    switch (adapterCode) {
      case "mock_provider_unavailable": return "provider_unavailable";
      case "mock_timeout": return "timeout";
      case "mock_partial_batch_failure": return "partial_processing";
      default: return null;
    }
  }
  return "internal";
}

export class STAAHMockSynchronizationService {
  private readonly management: STAAHConnectionManagementService;
  private readonly reservations: ReservationRecordRepository;

  constructor(
    db: D1Database,
    management = new STAAHConnectionManagementService(db),
    reservations = new ReservationRecordRepository(db),
    private readonly delivery?: {
      consumer: ReservationIntegrationEventConsumer;
      queue: Pick<Queue<GHLInboundQueueEnvelope>, "send">;
    },
  ) {
    this.management = management;
    this.reservations = reservations;
  }

  async property(tenantId: string, integrationId: string): Promise<{
    property: STAAHMockProperty;
    mappings: STAAHResourceMapping[];
    mappingDiagnostics: {
      status: "not_persisted" | "valid" | "missing" | "conflicting";
      persistedCount: number;
      expectedCount: number;
      missingCount: number;
      conflictingCount: number;
    };
  }> {
    const operation = await this.management.loadOperationalConnection(tenantId, integrationId);
    const adapter = resolveSTAAHAdapter(operation.context, {
      mode: "mock",
      profile: "crm",
      mockFailureScenario: operation.mockFailureScenario,
    });
    const property = await adapter.getProperty(operation.context, operation.syntheticPropertyId);
    const expectedMappings = buildDefaultSTAAHResourceMappings(operation.context, property);
    const persisted = operation.resourceMappings;
    const missingCount = expectedMappings.filter((expected) =>
      !persisted.some((actual) => sameMappings([actual], [expected]))
    ).length;
    const conflictingCount = persisted.filter((actual) =>
      !expectedMappings.some((expected) => sameMappings([actual], [expected]))
    ).length;
    const mappingStatus = persisted.length === 0
      ? "not_persisted"
      : conflictingCount > 0
        ? "conflicting"
        : missingCount > 0
          ? "missing"
          : "valid";
    return {
      property,
      // Preserve the existing response contract: before first sync, expose
      // deterministic preview mappings; otherwise expose persisted mappings.
      mappings: persisted.length > 0 ? persisted : expectedMappings,
      mappingDiagnostics: {
        status: mappingStatus,
        persistedCount: persisted.length,
        expectedCount: expectedMappings.length,
        missingCount,
        conflictingCount,
      },
    };
  }

  async synchronize(tenantId: string, integrationId: string): Promise<STAAHSyncResult> {
    const initial = await this.management.loadOperationalConnection(tenantId, integrationId);
    const checkpoint = initial.syncCheckpoint;
    if (
      checkpoint.status === "running" &&
      checkpoint.leaseExpiresAt !== null &&
      Date.parse(checkpoint.leaseExpiresAt) > Date.now()
    ) {
      throw new STAAHSyncError(409, "A STAAH mock synchronization is already running.", "sync_already_running");
    }

    const attemptId = crypto.randomUUID();
    let currentCheckpoint = emptyCheckpoint(attemptId, new Date().toISOString());
    if (!await this.management.updateSyncState(
      tenantId, integrationId, initial.record.settings, currentCheckpoint,
    )) {
      throw new STAAHSyncError(409, "STAAH synchronization state changed; inspect and retry.");
    }

    try {
      let operation = await this.requireOwnedRun(tenantId, integrationId, attemptId);
      const adapter = resolveSTAAHAdapter(operation.context, {
        mode: "mock",
        profile: "crm",
        mockFailureScenario: operation.mockFailureScenario,
      });
      const property = await adapter.getProperty(operation.context, operation.syntheticPropertyId);
      const expectedMappings = buildDefaultSTAAHResourceMappings(operation.context, property);
      const mappings = await this.ensureMappings(operation, expectedMappings, attemptId);
      operation = await this.requireOwnedRun(tenantId, integrationId, attemptId);
      const batch = await adapter.getReservations(operation.context, property.providerPropertyId);

      for (const [index, source] of batch.reservations.entries()) {
        operation = await this.requireOwnedRun(tenantId, integrationId, attemptId);
        let normalized: ReservationPayload;
        try {
          normalized = normalizeSTAAHReservation(operation.context, property, mappings, source);
        } catch (error: unknown) {
          if (!(error instanceof STAAHReservationNormalizationError)) throw error;
          currentCheckpoint = { ...operation.syncCheckpoint,
            processedCount: operation.syncCheckpoint.processedCount + 1,
            rejectedCount: operation.syncCheckpoint.rejectedCount + 1,
          };
          operation = await this.advance(tenantId, integrationId, attemptId, currentCheckpoint);
          continue;
        }

        const lifecycle = lifecycleOf(normalized);
        let result: Awaited<ReturnType<ReservationRecordRepository["persistProviderReservation"]>>;
        try {
          const record = {
            tenantId,
            canonicalReservationId: createCanonicalReservationId(),
            provider: "staah",
            providerConnectionId: integrationId,
            providerPropertyId: property.providerPropertyId,
            providerReservationId: normalized.reservationId,
            revision: source.revision,
            lifecycle,
            payload: JSON.stringify(normalized),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (this.delivery) {
            const authorized = await this.delivery.consumer.authorizeDelivery(tenantId, "staah", integrationId);
            const persisted = await this.reservations.persistProviderReservationWithEvent(record, authorized.destination.id);
            result = persisted.outcome;
            if (persisted.eventId) {
              try {
                await this.delivery.queue.send({
                  version: 1, kind: "reservation", tenantId, sourceEventId: persisted.eventId,
                });
              } catch {
                // The reservation AND event are committed. Recovery re-notifies
                // this durable identity independently of a future STAAH sync.
                console.warn("Reservation event notification deferred.", {
                  operation: "reservation_event_enqueue", outcome: "durable_pending",
                });
              }
            }
          } else {
            result = await this.reservations.persistProviderReservation(record);
          }
        } catch {
          throw new STAAHReservationPersistenceError();
        }

        if (result === "conflict") {
          throw new STAAHReservationRevisionConflictError();
        }

        const prior = operation.syncCheckpoint;
        currentCheckpoint = {
          ...prior,
          processedCount: prior.processedCount + 1,
          insertedCount: prior.insertedCount + (result === "inserted" ? 1 : 0),
          updatedCount: prior.updatedCount + (result === "updated" ? 1 : 0),
          unchangedCount: prior.unchangedCount + (result === "unchanged" ? 1 : 0),
          rejectedCount: prior.rejectedCount + (result === "stale" ? 1 : 0),
        };
        operation = await this.advance(tenantId, integrationId, attemptId, currentCheckpoint);

        if (batch.failAfterReservations === index + 1) {
          throw new STAAHAdapterError("mock_partial_batch_failure", "Synthetic partial batch failure.");
        }
      }

      operation = await this.requireOwnedRun(tenantId, integrationId, attemptId);
      currentCheckpoint = {
        ...operation.syncCheckpoint,
        status: "succeeded",
        leaseExpiresAt: null,
        completedAt: new Date().toISOString(),
        lastErrorCode: null,
      };
      await this.advance(tenantId, integrationId, attemptId, currentCheckpoint);
      return {
        provider: "staah",
        mode: "mock",
        tenantId,
        integrationId,
        propertyId: property.providerPropertyId,
        checkpoint: currentCheckpoint,
        counts: {
          processedCount: currentCheckpoint.processedCount,
          insertedCount: currentCheckpoint.insertedCount,
          updatedCount: currentCheckpoint.updatedCount,
          unchangedCount: currentCheckpoint.unchangedCount,
          rejectedCount: currentCheckpoint.rejectedCount,
        },
      };
    } catch (error: unknown) {
      const code = errorCode(error);
      const latest = await this.management.loadOperationalConnection(tenantId, integrationId).catch(() => null);
      if (latest?.syncCheckpoint.attemptId === attemptId) {
        const failed: STAAHSyncCheckpoint = {
          ...latest.syncCheckpoint,
          status: "failed",
          leaseExpiresAt: null,
          completedAt: new Date().toISOString(),
          lastErrorCode: code,
        };
        await this.management.updateSyncState(
          tenantId, integrationId, latest.record.settings, failed,
        );
      }
      if (error instanceof STAAHSyncError || error instanceof STAAHManagementError) throw error;
      if (error instanceof STAAHReservationPersistenceError) {
        throw new STAAHSyncError(503, "STAAH reservation persistence failed.", "persistence_failure");
      }
      throw new STAAHSyncError(503, `STAAH mock synchronization failed (${code}).`, code === "provider_unavailable" || code === "timeout" || code === "partial_processing" ? code : "sync_failed");
    }
  }

  private async ensureMappings(
    operation: STAAHOperationalConnection,
    expected: STAAHResourceMapping[],
    attemptId?: string,
  ): Promise<STAAHResourceMapping[]> {
    if (operation.resourceMappings.length > 0) {
      if (!sameMappings(operation.resourceMappings, expected)) {
        throw new STAAHSyncError(409, "STAAH resource mappings do not match the configured mock property.", "mapping_invalid");
      }
      return operation.resourceMappings;
    }
    const saved = await this.management.updateSyncState(
      operation.context.tenantId,
      operation.context.integrationId,
      operation.record.settings,
      operation.syncCheckpoint,
      expected,
    );
    if (!saved) throw new STAAHSyncError(409, "STAAH resource mappings changed concurrently.", "sync_lease_conflict");
    const reloaded = await this.management.loadOperationalConnection(
      operation.context.tenantId,
      operation.context.integrationId,
    );
    if (attemptId && reloaded.syncCheckpoint.attemptId !== attemptId) {
      throw new STAAHSyncError(409, "STAAH synchronization lease was lost.", "sync_lease_conflict");
    }
    if (!sameMappings(reloaded.resourceMappings, expected)) {
      throw new STAAHSyncError(409, "STAAH resource mappings could not be verified.", "mapping_invalid");
    }
    return reloaded.resourceMappings;
  }

  private async requireOwnedRun(
    tenantId: string,
    integrationId: string,
    attemptId: string,
  ): Promise<STAAHOperationalConnection> {
    const operation = await this.management.loadOperationalConnection(tenantId, integrationId);
    if (
      operation.syncCheckpoint.status !== "running" ||
      operation.syncCheckpoint.attemptId !== attemptId ||
      !operation.syncCheckpoint.leaseExpiresAt ||
      Date.parse(operation.syncCheckpoint.leaseExpiresAt) <= Date.now()
    ) {
      throw new STAAHSyncError(409, "STAAH synchronization lease is no longer valid.", "sync_lease_conflict");
    }
    return operation;
  }

  private async advance(
    tenantId: string,
    integrationId: string,
    attemptId: string,
    checkpoint: STAAHSyncCheckpoint,
  ): Promise<STAAHOperationalConnection> {
    const current = await this.requireOwnedRun(tenantId, integrationId, attemptId);
    const renewed = checkpoint.status === "running"
      ? { ...checkpoint, leaseExpiresAt: new Date(Date.now() + CHECKPOINT_LEASE_MS).toISOString() }
      : checkpoint;
    const saved = await this.management.updateSyncState(
      tenantId,
      integrationId,
      current.record.settings,
      renewed,
    );
    if (!saved) throw new STAAHSyncError(409, "STAAH synchronization checkpoint changed concurrently.", "sync_lease_conflict");
    if (renewed.status !== "running") {
      return this.management.loadOperationalConnection(tenantId, integrationId);
    }
    return this.requireOwnedRun(tenantId, integrationId, attemptId);
  }
}

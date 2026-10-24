import type { RequestContext } from "../../context";
import type { CRMAdapter } from "../../core/crm";
import { ApiError } from "../../core/errors/ApiError";
import {
  IntegrationEventProcessingError,
} from "../../core/events/errors";
import type { IntegrationEventService } from "../../core/events/service";
import type { IntegrationEventRecord } from "../../persistence/models/integration-event";
import type { IntegrationRecord } from "../../persistence/models/integration";
import { CredentialRepository } from "../../persistence/repositories/credential-repository";
import { IntegrationRepository } from "../../persistence/repositories/integration-repository";
import { ReservationRecordRepository } from "../../persistence/repositories/reservation-record-repository";
import { CanonicalReservationEventType } from "./canonical-events";
import { mapReservationToContact } from "./mapper";
import { mapReservationToOpportunity } from "./opportunity";
import type { ReservationPayload } from "./types";
import { validateReservation } from "./validator";

const supportedTypes = new Set<string>(Object.values(CanonicalReservationEventType));

interface ReservationDeliveryEventPayload {
  canonicalReservationId: string;
  sourceIntegrationId: string;
  destinationIntegrationId: string;
}

interface ReservationDeliverySettings {
  enabled: true;
  mode: "mock";
  sourceIntegrationIds: string[];
  locationId: string;
}

export interface ReservationEventConsumerDependencies {
  db: D1Database;
  destinationAdapter: CRMAdapter;
  createDestinationContext(input: {
    tenantId: string;
    destinationIntegration: IntegrationRecord;
    locationId: string;
  }): Promise<RequestContext> | RequestContext;
}

export type ReservationEventConsumerOutcome =
  | { state: "delivered"; contactId: string; opportunityId: string }
  | { state: "stale" }
  | { state: "already_processed" }
  | { state: "lease_active"; retryAfterSeconds: number };

function permanent(
  code: "INVALID_EVENT" | "PROVIDER_NORMALIZATION_FAILED" | "PROVIDER_REQUEST_REJECTED" |
    "PROVIDER_UNSUPPORTED" | "TENANT_CONTEXT_INVALID",
  message: string,
): IntegrationEventProcessingError {
  return new IntegrationEventProcessingError({
    code,
    severity: "error",
    message,
    retryable: false,
  });
}

function retryable(message: string, cause?: unknown): IntegrationEventProcessingError {
  return new IntegrationEventProcessingError({
    code: "PERSISTENCE_FAILURE",
    severity: "error",
    message,
    retryable: true,
    cause,
  });
}

function parseEventPayload(event: IntegrationEventRecord): ReservationDeliveryEventPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(event.payload) as unknown;
  } catch {
    throw permanent("INVALID_EVENT", "Reservation delivery event payload is invalid.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw permanent("INVALID_EVENT", "Reservation delivery event payload is invalid.");
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.canonicalReservationId !== "string" || !value.canonicalReservationId.trim() ||
    typeof value.sourceIntegrationId !== "string" || !value.sourceIntegrationId.trim() ||
    typeof value.destinationIntegrationId !== "string" || !value.destinationIntegrationId.trim()
  ) {
    throw permanent("INVALID_EVENT", "Reservation delivery event references are invalid.");
  }
  return {
    canonicalReservationId: value.canonicalReservationId.trim(),
    sourceIntegrationId: value.sourceIntegrationId.trim(),
    destinationIntegrationId: value.destinationIntegrationId.trim(),
  };
}

function parseDeliverySettings(integration: IntegrationRecord): ReservationDeliverySettings {
  let settings: unknown;
  try {
    settings = integration.settings ? JSON.parse(integration.settings) as unknown : null;
  } catch {
    throw permanent("PROVIDER_NORMALIZATION_FAILED", "Destination delivery configuration is invalid.");
  }
  const route = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).reservationEventDelivery
    : undefined;
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw permanent("PROVIDER_REQUEST_REJECTED", "Reservation event delivery is not enabled.");
  }
  const value = route as Record<string, unknown>;
  if (value.enabled !== true) {
    throw permanent("PROVIDER_REQUEST_REJECTED", "Reservation event delivery is disabled.");
  }
  if (value.mode !== "mock") {
    throw permanent("PROVIDER_UNSUPPORTED", "Live reservation event delivery is not supported.");
  }
  if (
    !Array.isArray(value.sourceIntegrationIds) ||
    !value.sourceIntegrationIds.every((item) => typeof item === "string" && item.trim()) ||
    typeof value.locationId !== "string" || !value.locationId.trim()
  ) {
    throw permanent("PROVIDER_NORMALIZATION_FAILED", "Destination delivery configuration is invalid.");
  }
  return {
    enabled: true,
    mode: "mock",
    sourceIntegrationIds: value.sourceIntegrationIds.map((item) => String(item).trim()),
    locationId: value.locationId.trim(),
  };
}

function parseCanonicalReservation(payload: string): ReservationPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(payload) as unknown;
  } catch {
    throw permanent("PROVIDER_NORMALIZATION_FAILED", "Canonical reservation payload is invalid.");
  }
  try {
    return validateReservation(raw as ReservationPayload);
  } catch {
    throw permanent("PROVIDER_NORMALIZATION_FAILED", "Canonical reservation payload is invalid.");
  }
}

function classifyDestinationError(error: unknown): IntegrationEventProcessingError {
  if (error instanceof IntegrationEventProcessingError) return error;
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 429
      ? retryable("Reservation destination is temporarily unavailable.", error)
      : permanent("PROVIDER_REQUEST_REJECTED", "Reservation destination rejected the delivery.");
  }
  return retryable("Reservation destination delivery failed.", error);
}

export class ReservationIntegrationEventConsumer {
  private readonly integrations: IntegrationRepository;
  private readonly credentials: CredentialRepository;
  private readonly reservations: ReservationRecordRepository;

  constructor(private readonly dependencies: ReservationEventConsumerDependencies) {
    this.integrations = new IntegrationRepository(dependencies.db);
    this.credentials = new CredentialRepository(dependencies.db);
    this.reservations = new ReservationRecordRepository(dependencies.db);
  }

  supports(eventType: string): boolean {
    return supportedTypes.has(eventType);
  }

  /** Shared producer/consumer authorization. This does not call a provider. */
  async authorizeDelivery(
    tenantId: string,
    provider: string,
    sourceIntegrationId: string,
    destinationIntegrationId?: string,
  ): Promise<{ source: IntegrationRecord; destination: IntegrationRecord; context: RequestContext }> {
    const source = await this.integrations.findByTenantAndProvider(tenantId, provider);
    if (!source || source.id !== sourceIntegrationId || source.enabled !== 1 || provider !== "staah") {
      throw permanent("TENANT_CONTEXT_INVALID", "Reservation source integration validation failed.");
    }
    const destination = await this.integrations.findByTenantAndProvider(tenantId, "gohighlevel");
    if (!destination || destination.id === source.id ||
        (destinationIntegrationId !== undefined && destination.id !== destinationIntegrationId)) {
      throw permanent("TENANT_CONTEXT_INVALID", "Reservation destination integration validation failed.");
    }
    if (destination.enabled !== 1) {
      throw permanent("PROVIDER_REQUEST_REJECTED", "Reservation destination integration is disabled.");
    }
    const delivery = parseDeliverySettings(destination);
    if (!delivery.sourceIntegrationIds.includes(source.id)) {
      throw permanent("TENANT_CONTEXT_INVALID", "Reservation source is not authorized for this destination.");
    }

    // Ownership lookup reads only tenant identity, never API keys or refresh tokens.
    const owner = await this.credentials.findTenantIdByProviderAndLocation("gohighlevel", delivery.locationId);
    if (owner !== tenantId) {
      throw permanent("TENANT_CONTEXT_INVALID", "Destination location ownership validation failed.");
    }

    const context = await this.dependencies.createDestinationContext({
      tenantId,
      destinationIntegration: destination,
      locationId: delivery.locationId,
    });
    if (
      context.tenant.id !== tenantId ||
      context.tenant.status !== "active" ||
      context.tenant.integrations.crm.id !== destination.id ||
      context.tenant.integrations.crm.provider !== "gohighlevel" ||
      context.tenant.integrations.crm.credentials.locationId !== delivery.locationId ||
      context.integrationRuntime.transportMode !== "mock" ||
      typeof context.integrationRuntime.httpTransport?.fetch !== "function" ||
      typeof context.integrationRuntime.httpTransport?.credentials?.resolve !== "function"
    ) {
      throw permanent("TENANT_CONTEXT_INVALID", "Trusted mock destination context validation failed.");
    }
    const destinationConfiguration = context.tenant.integrations.crm.configuration;
    if (
      !destinationConfiguration ||
      !destinationConfiguration.attributeMappings.some(
        (mapping) => mapping.canonicalKey === "reservation.id" && mapping.providerFieldId.trim(),
      ) ||
      !destinationConfiguration.workflow.providerWorkflowId.trim() ||
      destinationConfiguration.workflow.states.length === 0
    ) {
      throw permanent("PROVIDER_NORMALIZATION_FAILED", "Reservation destination mapping is invalid.");
    }
    return { source, destination, context };
  }

  async consume(event: IntegrationEventRecord): Promise<ReservationEventConsumerOutcome> {
    if (!this.supports(event.eventType) || event.aggregateType !== "reservation") {
      throw permanent("PROVIDER_UNSUPPORTED", "Integration event type is not supported by the reservation consumer.");
    }
    if (event.revision === undefined || !Number.isInteger(event.revision) || event.revision < 0) {
      throw permanent("INVALID_EVENT", "Reservation event revision is invalid.");
    }
    const payload = parseEventPayload(event);
    if (payload.canonicalReservationId !== event.aggregateId) {
      throw permanent("INVALID_EVENT", "Reservation event identity does not match its aggregate.");
    }
    const { source, context } = await this.authorizeDelivery(
      event.tenantId, event.provider ?? "", payload.sourceIntegrationId, payload.destinationIntegrationId,
    );
    const record = await this.reservations.find(event.tenantId, payload.canonicalReservationId);
    if (!record) throw permanent("INVALID_EVENT", "Canonical reservation was not found.");
    if (record.provider !== source.provider || record.providerConnectionId !== source.id) {
      throw permanent("TENANT_CONTEXT_INVALID", "Canonical reservation source validation failed.");
    }
    if (event.revision < record.revision) return { state: "stale" };
    if (event.revision > record.revision) {
      throw permanent("INVALID_EVENT", "Reservation event revision is newer than committed state.");
    }
    const reservation = parseCanonicalReservation(record.payload);

    try {
      const contact = await this.dependencies.destinationAdapter.upsertContact(
        context,
        mapReservationToContact(reservation),
      );
      if (!contact.id) throw permanent("PROVIDER_NORMALIZATION_FAILED", "Destination contact identity is missing.");

      let opportunity;
      try {
        opportunity = mapReservationToOpportunity(reservation, contact.id);
      } catch {
        throw permanent("PROVIDER_NORMALIZATION_FAILED", "Reservation destination mapping is invalid.");
      }
      const existing = await this.dependencies.destinationAdapter.searchOpportunity(
        context,
        contact.id,
        reservation.reservationId,
      );
      const delivered = existing
        ? await this.dependencies.destinationAdapter.updateOpportunity(context, existing.id, opportunity)
        : await this.dependencies.destinationAdapter.upsertOpportunity(context, opportunity);
      if (!delivered.id) throw permanent("PROVIDER_NORMALIZATION_FAILED", "Destination opportunity identity is missing.");
      return { state: "delivered", contactId: contact.id, opportunityId: delivered.id };
    } catch (error) {
      throw classifyDestinationError(error);
    }
  }

}

/** Runs reservation delivery under the existing durable event lease lifecycle. */
export async function processReservationIntegrationEvent(
  event: IntegrationEventRecord,
  service: Pick<IntegrationEventService,
    "claimForProcessing" | "renewProcessingLease" | "markProcessed" | "markFailed">,
  consumer: ReservationIntegrationEventConsumer,
): Promise<ReservationEventConsumerOutcome> {
  const claim = await service.claimForProcessing(event.tenantId, event.eventId);
  if (claim.state === "active") {
    const expiresAt = claim.leaseExpiresAt ? Date.parse(claim.leaseExpiresAt) : Date.now() + 5_000;
    return { state: "lease_active", retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) };
  }
  if (claim.state === "processed" || claim.state === "terminal" || claim.state === "exhausted") {
    return { state: "already_processed" };
  }
  if (claim.state !== "claimed") throw retryable("Reservation event claim could not be acquired.");

  const heartbeat = setInterval(() => {
    void service.renewProcessingLease(event.tenantId, event.eventId, claim.leaseToken).catch(() => false);
  }, 30_000);
  try {
    const outcome = await consumer.consume(event);
    const completed = await service.markProcessed(event.tenantId, event.eventId, claim.leaseToken);
    if (!completed) throw retryable("Reservation event lease was lost before completion.");
    return outcome;
  } catch (error) {
    await service.markFailed(event.tenantId, event.eventId, error, claim.leaseToken);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

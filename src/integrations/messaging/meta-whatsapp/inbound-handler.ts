import type { D1Database } from "@cloudflare/workers-types";
import { IntegrationEventProcessingError } from "../../../core/events/errors";
import { IntegrationEventService } from "../../../core/events/service";
import { processKnowledgeEventWithLease } from "../../../domain/knowledge/queue-processing";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { MessagingConversationRepository } from "../../../persistence/repositories/messaging-conversation-repository";
import { reconcileMetaWhatsAppStatus } from "./outbound";
import type { IntegrationEventRecord } from "../../../persistence/models/integration-event";
import type { AppBindings } from "../../../config/app";
import { IntegrationEventRepository } from "../../../persistence/repositories/integration-event-repository";
import { createIntegrationContext } from "../../../context/integration";
import { createIntegrationRuntime } from "../../../application/integration/runtime";
import { resolveTenant } from "../../../tenants/service";
import { ApiError } from "../../../core/errors/ApiError";
import { publishGHLCustomInboundForTenant } from "../gohighlevel/custom-conversation-provider";
import { isGHLProviderPilotLocationAuthorized } from "../gohighlevel/custom-provider-pilot-config";
import { lookupGHLContactByPhone } from "../../../integrations/crm/gohighlevel/contacts/lookup";
import { isMetaWhatsAppGHLInboundEnabled } from "./gohighlevel-inbound-config";

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export type MetaWhatsAppGHLInboundForwarder = (input: {
  event: IntegrationEventRecord;
  value: Record<string, unknown>;
  connection: Awaited<ReturnType<MetaWhatsAppConnectionRepository["findActiveByPhoneNumberId"]>>;
  env: AppBindings;
}) => Promise<void>;

function classifyGHLForwardingFailure(error: unknown): IntegrationEventProcessingError {
  if (error instanceof IntegrationEventProcessingError) return error;
  if (error instanceof ApiError) {
    const retryable = error.status === 429 || error.status >= 500;
    return new IntegrationEventProcessingError({
      code: retryable ? "PROVIDER_TRANSIENT" : "PROVIDER_REQUEST_REJECTED",
      severity: "error",
      message: retryable ? "GHL inbound publication can be retried." : "GHL rejected the inbound publication.",
      retryable,
      cause: error,
    });
  }
  return new IntegrationEventProcessingError({
    code: "OUTBOUND_DELIVERY_UNKNOWN",
    severity: "error",
    message: "GHL inbound publication outcome is unknown.",
    retryable: false,
    cause: error,
  });
}

export const forwardMetaWhatsAppInboundToGHL: MetaWhatsAppGHLInboundForwarder = async ({ event, value, connection, env }) => {
  if (!connection || !isMetaWhatsAppGHLInboundEnabled(env, event.tenantId)) return;
  const tenant = await resolveTenant(env.DB, event.tenantId);
  if (tenant.id !== event.tenantId || tenant.integrations.crm.provider !== "gohighlevel") {
    throw new IntegrationEventProcessingError({ code: "TENANT_CONTEXT_INVALID", severity: "error", message: "Meta-to-GHL tenant ownership is invalid.", retryable: false });
  }
  if (!isGHLProviderPilotLocationAuthorized(env, tenant.integrations.crm.credentials.locationId)) {
    throw new IntegrationEventProcessingError({ code: "PROVIDER_UNSUPPORTED", severity: "error", message: "Meta-to-GHL forwarding is not authorized for this location.", retryable: false });
  }
  const sender = typeof value.contactId === "string" ? value.contactId : "";
  const runtime = createIntegrationRuntime("gohighlevel", {
    DB: env.DB,
    GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
    GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
    GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
  });
  const context = createIntegrationContext(tenant, "gohighlevel", runtime);
  try {
    const contactId = await lookupGHLContactByPhone(context, sender);
    if (!contactId) {
      throw new IntegrationEventProcessingError({ code: "PROVIDER_REQUEST_REJECTED", severity: "error", message: "No authorized GHL contact matched the Meta sender.", retryable: false });
    }
    await publishGHLCustomInboundForTenant(context, {
      contactId,
      message: String(value.text),
      conversationId: `${connection.phoneNumberId}:${sender}`,
      altId: String(value.providerMessageId),
      occurredAt: String(value.occurredAt),
    }, env);
  } catch (error) {
    throw classifyGHLForwardingFailure(error);
  }
};

export async function processMetaWhatsAppInboundEvent(
  event: IntegrationEventRecord,
  db: D1Database,
  service: IntegrationEventService,
  env?: AppBindings,
  forwarder: MetaWhatsAppGHLInboundForwarder = forwardMetaWhatsAppInboundToGHL,
): Promise<number | null> {
  if (event.provider !== "meta_whatsapp") throw new IntegrationEventProcessingError({ code: "TENANT_CONTEXT_INVALID", severity: "error", message: "Meta event provider is invalid.", retryable: false });
  return processKnowledgeEventWithLease(event, service, async () => {
    let value: unknown; try { value = JSON.parse(event.payload); } catch { throw new IntegrationEventProcessingError({ code: "INVALID_EVENT", severity: "error", message: "Meta event payload is invalid.", retryable: false }); }
    if (!record(value)) throw new IntegrationEventProcessingError({ code: "INVALID_EVENT", severity: "error", message: "Meta event payload is unsupported.", retryable: false });
    const connection = typeof value.phoneNumberId === "string" ? await new MetaWhatsAppConnectionRepository(db).findActiveByPhoneNumberId(value.phoneNumberId) : null;
    if (!connection || connection.tenantId !== event.tenantId) throw new IntegrationEventProcessingError({ code: "TENANT_CONTEXT_INVALID", severity: "error", message: "Meta connection ownership is invalid.", retryable: false });
    if (event.eventType === "messaging.meta_whatsapp.status") {
      if (typeof value.providerMessageId !== "string" || typeof value.status !== "string") throw new IntegrationEventProcessingError({ code: "INVALID_EVENT", severity: "error", message: "Meta status payload is unsupported.", retryable: false });
      await reconcileMetaWhatsAppStatus(db, { tenantId: event.tenantId, connectionId: connection.id, providerMessageId: value.providerMessageId, status: value.status }); return;
    }
    if (event.eventType !== "messaging.meta_whatsapp.inbound" || value.provider !== "meta_whatsapp" || typeof value.contactId !== "string" || typeof value.providerMessageId !== "string" || typeof value.text !== "string" || typeof value.occurredAt !== "string") throw new IntegrationEventProcessingError({ code: "INVALID_EVENT", severity: "error", message: "Meta event payload is unsupported.", retryable: false });
    await new MessagingConversationRepository(db).upsertInbound({
      tenantId: event.tenantId,
      connectionId: connection.id,
      participantId: value.contactId,
      externalMessageId: value.providerMessageId,
      occurredAt: value.occurredAt,
      text: value.text,
      channel: "whatsapp",
      channelProviderId: connection.phoneNumberId,
    });
    if (env) await forwarder({ event, value, connection, env });
  });
}
export function createMetaWhatsAppInboundHandler(): (event: IntegrationEventRecord, env: AppBindings) => Promise<number | null> {
  return (event, env) => processMetaWhatsAppInboundEvent(event, env.DB, new IntegrationEventService(new IntegrationEventRepository(env.DB)), env);
}

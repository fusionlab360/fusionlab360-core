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

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export async function processMetaWhatsAppInboundEvent(event: IntegrationEventRecord, db: D1Database, service: IntegrationEventService): Promise<number | null> {
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
  });
}
export function createMetaWhatsAppInboundHandler(): (event: IntegrationEventRecord, env: AppBindings) => Promise<number | null> {
  return (event, env) => processMetaWhatsAppInboundEvent(event, env.DB, new IntegrationEventService(new IntegrationEventRepository(env.DB)));
}

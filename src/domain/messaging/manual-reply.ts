import type { AppBindings } from "../../config/app";
import { createIntegrationRuntime } from "../../application/integration/runtime";
import { createIntegrationContext, type IntegrationContext } from "../../context/integration";
import { resolveTenant } from "../../tenants/service";
import { goHighLevelMessagingProvider } from "../../integrations/messaging/gohighlevel/provider";
import { searchGHLConversations, type GHLConversationSummary } from "../../integrations/messaging/gohighlevel/conversations";
import { KnownNonDeliveryError, type MessagingProvider } from "../../core/messaging";
import { MessagingOutboundDeliveryRepository } from "../../persistence/repositories/messaging-outbound-delivery-repository";

export type ManualGHLReplyResult =
  | { state: "accepted"; providerMessageId: string; conversationId: string }
  | { state: "unknown"; code: string }
  | { state: "permanent"; code: string }
  | { state: "conflict"; code: string };

const supportedChannels = new Set([
  "whatsapp", "sms", "email", "live_chat", "live-chat", "livechat",
  "instagram", "ig", "facebook", "fb", "custom",
]);

function normalizeChannel(channel: string): string {
  const normalized = channel.trim().toLowerCase();
  if (normalized === "type_live_chat") return "live_chat";
  return normalized;
}

function createRuntime(env: AppBindings) {
  return createIntegrationRuntime("gohighlevel", {
    DB: env.DB,
    GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
    GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
    GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
  });
}

export async function deliverManualGHLReply(
  db: D1Database,
  context: IntegrationContext,
  conversation: GHLConversationSummary,
  text: string,
  idempotencyKey: string,
  provider: MessagingProvider = goHighLevelMessagingProvider,
): Promise<ManualGHLReplyResult> {
  const channel = normalizeChannel(conversation.channel);
  if (!supportedChannels.has(channel)) return { state: "permanent", code: "UNSUPPORTED_CHANNEL" };
  if (!conversation.contactId || !conversation.locationId || conversation.externalParticipantId !== conversation.contactId) {
    return { state: "permanent", code: "CONTACT_NOT_RESOLVED" };
  }

  const eventId = `console-manual-reply:${context.tenant.id}:${conversation.externalConversationId}`;
  const effectKey = `manual:${idempotencyKey}`;
  const repository = new MessagingOutboundDeliveryRepository(db);
  const reservation = await repository.reserve({
    tenantId: context.tenant.id,
    eventId,
    provider: "gohighlevel",
    effectKey,
    payload: {
      conversationId: conversation.externalConversationId,
      contactId: conversation.contactId,
      text,
      channel,
      origin: "manual_agent",
    },
  });
  if (reservation.state === "conflict") return { state: "conflict", code: "IDEMPOTENCY_CONFLICT" };
  if (reservation.state === "active") return { state: "unknown", code: "DELIVERY_IN_PROGRESS" };
  if (reservation.state === "unknown") return { state: "unknown", code: "OUTCOME_UNCONFIRMED" };
  if (reservation.state === "sent") return { state: "accepted", providerMessageId: reservation.messageId, conversationId: reservation.conversationId };

  try {
    const result = await provider.sendText(context, {
      conversationId: conversation.externalConversationId,
      contactId: conversation.contactId,
      text,
      channel,
    });
    const recorded = await repository.markSent({
      tenantId: context.tenant.id,
      eventId,
      effectKey,
      leaseToken: reservation.leaseToken,
      messageId: result.messageId,
      conversationId: result.conversationId,
    });
    if (!recorded) {
      await repository.markUnknown({
        tenantId: context.tenant.id,
        eventId,
        effectKey,
        leaseToken: reservation.leaseToken,
        errorCode: "SEND_RESULT_NOT_PERSISTED",
      });
      return { state: "unknown", code: "SEND_RESULT_NOT_PERSISTED" };
    }
    return { state: "accepted", providerMessageId: result.messageId, conversationId: result.conversationId };
  } catch (error: unknown) {
    if (error instanceof KnownNonDeliveryError) {
      await repository.markFailed({
        tenantId: context.tenant.id,
        eventId,
        effectKey,
        leaseToken: reservation.leaseToken,
        errorCode: "KNOWN_NON_DELIVERY",
      });
      return { state: "permanent", code: "KNOWN_NON_DELIVERY" };
    }
    await repository.markUnknown({
      tenantId: context.tenant.id,
      eventId,
      effectKey,
      leaseToken: reservation.leaseToken,
      errorCode: error instanceof Error ? error.name : "PROVIDER_ERROR",
    });
    return { state: "unknown", code: "OUTCOME_UNCONFIRMED" };
  }
}

export async function sendManualGHLReply(
  env: AppBindings,
  tenantId: string,
  conversationId: string,
  text: string,
  idempotencyKey: string,
  provider?: MessagingProvider,
): Promise<ManualGHLReplyResult> {
  const tenant = await resolveTenant(env.DB, tenantId);
  if (tenant.integrations.crm.provider !== "gohighlevel") return { state: "permanent", code: "GHL_NOT_CONFIGURED" };
  const locationId = tenant.integrations.crm.credentials.locationId?.trim();
  if (!locationId) return { state: "permanent", code: "GHL_LOCATION_NOT_CONFIGURED" };
  const context = createIntegrationContext(tenant, "gohighlevel", createRuntime(env));
  const search = await searchGHLConversations(context, { limit: 100, page: 1 });
  const conversation = search.items.find((item) => item.externalConversationId === conversationId);
  if (!conversation || conversation.locationId !== locationId) return { state: "permanent", code: "CONVERSATION_NOT_FOUND" };
  return deliverManualGHLReply(env.DB, context, conversation, text, idempotencyKey, provider);
}

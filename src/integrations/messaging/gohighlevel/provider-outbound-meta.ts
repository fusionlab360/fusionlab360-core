import type { AppBindings } from "../../../config/app";
import { createIntegrationContext } from "../../../context/integration";
import { createIntegrationRuntime } from "../../../application/integration/runtime";
import { lookupGHLContactByPhone, normalizeMetaSenderPhone } from "../../crm/gohighlevel/contacts/lookup";
import { createMetaWhatsAppOutboundService, type MetaSendOutcome } from "../meta-whatsapp/outbound";
import { MetaWhatsAppConnectionRepository } from "../meta-whatsapp/persistence/connection-repository";
import type { Tenant } from "../../../tenants/types";
import type { GHLProviderOutboundPayload } from "./provider-outbound";
import { resolveGHLConversationProviderId } from "./custom-conversation-provider";

export const GHL_META_OUTBOUND_TENANT = "gmmetro";
export const GHL_META_OUTBOUND_LOCATION = "Npx2IdDDRjXz2QW3Svx4";
export const GHL_META_OUTBOUND_PROVIDER = "6adf3e12b24f5676a1ef327b";
export const GHL_META_OUTBOUND_PHONE_NUMBER_ID = "1452502451268655";
export const GHL_META_OUTBOUND_RECIPIENT = "+60176177115";

type BridgeBindings = Pick<AppBindings,
  | "DB"
  | "GHL_OAUTH_CLIENT_ID"
  | "GHL_OAUTH_CLIENT_SECRET"
  | "GHL_OAUTH_REDIRECT_URI"
  | "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS"
  | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION"
  | "META_WHATSAPP_GRAPH_API_VERSION"
  | "GHL_META_WHATSAPP_OUTBOUND_ENABLED"
>;

export interface GHLMetaOutboundDependencies {
  lookupContact?: typeof lookupGHLContactByPhone;
  send?: (input: {
    tenantId: string;
    connectionId: string;
    conversationId: string;
    recipientId: string;
    text: string;
    effectKey: string;
  }) => Promise<MetaSendOutcome>;
}

export function isGHLMetaOutboundPilotEnabled(env: Pick<AppBindings, "GHL_META_WHATSAPP_OUTBOUND_ENABLED">): boolean {
  return env.GHL_META_WHATSAPP_OUTBOUND_ENABLED === "true";
}

/**
 * Bridge one signed provider callback to the existing Meta outbound boundary.
 * Every pilot identity is server-owned; the caller cannot select a destination.
 */
export async function deliverGHLProviderOutboundToMeta(
  env: BridgeBindings,
  tenant: Tenant,
  payload: GHLProviderOutboundPayload,
  dependencies: GHLMetaOutboundDependencies = {},
): Promise<MetaSendOutcome> {
  if (!isGHLMetaOutboundPilotEnabled(env) || tenant.id !== GHL_META_OUTBOUND_TENANT) {
    throw new Error("GHL-to-Meta outbound pilot is disabled.");
  }
  const locationId = tenant.integrations.crm.credentials.locationId.trim();
  if (locationId !== GHL_META_OUTBOUND_LOCATION || payload.locationId !== locationId) {
    throw new Error("GHL-to-Meta location ownership is invalid.");
  }
  if (resolveGHLConversationProviderId(tenant) !== GHL_META_OUTBOUND_PROVIDER) {
    throw new Error("GHL-to-Meta provider configuration is invalid.");
  }
  if (payload.type !== "SMS" || !payload.userId?.trim()) {
    throw new Error("Only an identified GHL agent text reply is supported.");
  }
  if (normalizeMetaSenderPhone(payload.phone) !== GHL_META_OUTBOUND_RECIPIENT) {
    throw new Error("GHL-to-Meta recipient is not authorized.");
  }

  const connection = await new MetaWhatsAppConnectionRepository(env.DB)
    .findActiveByPhoneNumberId(GHL_META_OUTBOUND_PHONE_NUMBER_ID);
  if (!connection || connection.tenantId !== tenant.id) {
    throw new Error("Meta WhatsApp connection ownership is invalid.");
  }

  const runtime = createIntegrationRuntime("gohighlevel", {
    DB: env.DB,
    GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
    GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
    GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
  });
  const context = createIntegrationContext(tenant, "gohighlevel", runtime);
  const contactId = await (dependencies.lookupContact ?? lookupGHLContactByPhone)(context, GHL_META_OUTBOUND_RECIPIENT);
  if (!contactId || contactId !== payload.contactId) {
    throw new Error("GHL contact ownership is invalid.");
  }

  const candidates = await env.DB.prepare(`
    SELECT id, external_participant_id
    FROM messaging_conversations
    WHERE tenant_id = ? AND provider = 'meta_whatsapp' AND connection_id = ?
    ORDER BY updated_at DESC
  `).bind(tenant.id, connection.id).all<{ id: string; external_participant_id: string }>();
  const matching = (candidates.results ?? []).filter((candidate) =>
    normalizeMetaSenderPhone(candidate.external_participant_id) === GHL_META_OUTBOUND_RECIPIENT,
  );
  if (matching.length !== 1) {
    throw new Error("Meta WhatsApp conversation ownership is unavailable or ambiguous.");
  }

  const send = dependencies.send ?? ((input) => createMetaWhatsAppOutboundService(env).send(input));
  return send({
    tenantId: tenant.id,
    connectionId: connection.id,
    conversationId: matching[0]!.id,
    recipientId: GHL_META_OUTBOUND_RECIPIENT,
    text: payload.message,
    effectKey: `ghl-provider:${payload.messageId}`,
  });
}

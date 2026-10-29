import type { AppBindings } from "../../../config/app";
import { ApiError } from "../../../core/errors/ApiError";
import { createIntegrationContext } from "../../../context/integration";
import { createIntegrationRuntime } from "../../../application/integration/runtime";
import { lookupGHLContactByPhone, normalizeMetaSenderPhone } from "../../crm/gohighlevel/contacts/lookup";
import { createMetaWhatsAppOutboundService, MetaWhatsAppOutboundError, type MetaSendOutcome } from "../meta-whatsapp/outbound";
import { MetaWhatsAppConnectionRepository } from "../meta-whatsapp/persistence/connection-repository";
import type { Tenant } from "../../../tenants/types";
import type { GHLProviderOutboundPayload } from "./provider-outbound";
import { resolveGHLConversationProviderId } from "./custom-conversation-provider";

export const GHL_META_OUTBOUND_TENANT = "gmmetro";
export const GHL_META_OUTBOUND_LOCATION = "Npx2IdDDRjXz2QW3Svx4";
export const GHL_META_OUTBOUND_PROVIDER = "6adf3e12b24f5676a1ef327b";
export const GHL_META_OUTBOUND_PHONE_NUMBER_ID = "1452502451268655";
export const GHL_META_OUTBOUND_RECIPIENT = "+60176177115";

export type GHLMetaOutboundFailureCode =
  | "PROVIDER_PAYLOAD_REJECTED"
  | "PROVIDER_IDENTITY_REJECTED"
  | "GHL_CONTACT_LOOKUP_FAILED"
  | "GHL_CONTACT_MISMATCH"
  | "META_CONNECTION_UNAVAILABLE"
  | "META_CONVERSATION_NOT_UNIQUE"
  | "META_CUSTOMER_WINDOW_EXPIRED"
  | "META_CREDENTIAL_UNAVAILABLE";

export class GHLMetaOutboundFailure extends Error {
  constructor(
    public readonly code: GHLMetaOutboundFailureCode,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "GHLMetaOutboundFailure";
  }
}

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
    throw new GHLMetaOutboundFailure("PROVIDER_IDENTITY_REJECTED", false, "The outbound pilot identity is not authorized.");
  }
  const locationId = tenant.integrations.crm.credentials.locationId.trim();
  if (locationId !== GHL_META_OUTBOUND_LOCATION || payload.locationId !== locationId) {
    throw new GHLMetaOutboundFailure("PROVIDER_IDENTITY_REJECTED", false, "The GHL location is not authorized.");
  }
  if (resolveGHLConversationProviderId(tenant) !== GHL_META_OUTBOUND_PROVIDER) {
    throw new GHLMetaOutboundFailure("PROVIDER_IDENTITY_REJECTED", false, "The GHL provider is not authorized.");
  }
  if (payload.type !== "SMS") {
    throw new GHLMetaOutboundFailure("PROVIDER_PAYLOAD_REJECTED", false, "Only SMS provider replies are supported.");
  }
  if (!payload.userId?.trim()) {
    throw new GHLMetaOutboundFailure("PROVIDER_IDENTITY_REJECTED", false, "An identified GHL agent reply is required.");
  }
  if (normalizeMetaSenderPhone(payload.phone) !== GHL_META_OUTBOUND_RECIPIENT) {
    throw new GHLMetaOutboundFailure("PROVIDER_IDENTITY_REJECTED", false, "The GHL recipient is not authorized.");
  }

  const connection = await new MetaWhatsAppConnectionRepository(env.DB)
    .findActiveByPhoneNumberId(GHL_META_OUTBOUND_PHONE_NUMBER_ID);
  if (!connection || connection.tenantId !== tenant.id) {
    throw new GHLMetaOutboundFailure("META_CONNECTION_UNAVAILABLE", false, "The Meta connection is unavailable.");
  }

  const runtime = createIntegrationRuntime("gohighlevel", {
    DB: env.DB,
    GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
    GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
    GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
  });
  const context = createIntegrationContext(tenant, "gohighlevel", runtime);
  let contactId: string | null;
  try {
    contactId = await (dependencies.lookupContact ?? lookupGHLContactByPhone)(context, GHL_META_OUTBOUND_RECIPIENT);
  } catch (error) {
    const retryable = !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;
    throw new GHLMetaOutboundFailure("GHL_CONTACT_LOOKUP_FAILED", retryable, "The GHL contact lookup could not be completed.");
  }
  if (!contactId || contactId !== payload.contactId) {
    throw new GHLMetaOutboundFailure("GHL_CONTACT_MISMATCH", false, "The GHL contact is not authorized.");
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
    throw new GHLMetaOutboundFailure("META_CONVERSATION_NOT_UNIQUE", false, "The Meta conversation is unavailable or ambiguous.");
  }

  const send = dependencies.send ?? ((input) => createMetaWhatsAppOutboundService(env).send(input));
  try {
    return await send({
      tenantId: tenant.id,
      connectionId: connection.id,
      conversationId: matching[0]!.id,
      recipientId: GHL_META_OUTBOUND_RECIPIENT,
      text: payload.message,
      effectKey: `ghl-provider:${payload.messageId}`,
    });
  } catch (error) {
    if (error instanceof MetaWhatsAppOutboundError && error.code) {
      throw new GHLMetaOutboundFailure(error.code, false, "The Meta outbound request was rejected before delivery.");
    }
    throw error;
  }
}

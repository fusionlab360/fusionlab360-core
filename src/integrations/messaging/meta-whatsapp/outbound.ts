import type { AppBindings } from "../../../config/app";
import { createMetaWhatsAppCredentialVault, MetaWhatsAppCredentialError } from "./credential-vault";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { MessagingConversationRepository } from "../../../persistence/repositories/messaging-conversation-repository";
import { createMetaWhatsAppGraphOutboundTransport } from "./graph-outbound-transport";
import type { MetaTransportFailureCategory } from "./transport-diagnostics";
import { formatMetaTransportErrorCode } from "./transport-diagnostics";
import { isMetaConnectionEligible } from "./connection-eligibility";

export type MetaSendOutcome =
  | { state: "accepted"; providerMessageId: string }
  | { state: "retryable"; code: string; retryAfterSeconds?: number }
  | { state: "permanent"; code: string }
  | { state: "unknown"; code: string; transportCategory?: MetaTransportFailureCategory };
export interface MetaWhatsAppTransport { sendText(input: { phoneNumberId: string; recipientId: string; text: string; accessToken: string }): Promise<MetaSendOutcome>; }
export type MetaWhatsAppOutboundErrorCode =
  | "PROVIDER_PAYLOAD_REJECTED"
  | "META_CONNECTION_UNAVAILABLE"
  | "META_CONNECTION_DISABLED"
  | "META_CONVERSATION_NOT_UNIQUE"
  | "META_CUSTOMER_WINDOW_EXPIRED"
  | "META_CREDENTIAL_EXPIRED"
  | "META_CREDENTIAL_INVALID"
  | "META_CREDENTIAL_EXPIRY_UNKNOWN"
  | "META_CREDENTIAL_NOT_VERIFIED"
  | "META_CREDENTIAL_DISABLED"
  | "META_OUTBOUND_DISABLED";

export class MetaWhatsAppOutboundError extends Error {
  constructor(message: string, public readonly code?: MetaWhatsAppOutboundErrorCode) {
    super(message);
    this.name = "MetaWhatsAppOutboundError";
  }
}

export class MetaWhatsAppOutboundService {
  constructor(
    private readonly db: D1Database,
    private readonly bindings: Pick<AppBindings, "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION" | "WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED" | "GHL_META_WHATSAPP_OUTBOUND_ENABLED">,
    private readonly transport: MetaWhatsAppTransport,
    private readonly now: () => number = Date.now,
  ) {}
  async send(input: { tenantId: string; connectionId: string; conversationId: string; recipientId: string; text: string; effectKey: string }): Promise<MetaSendOutcome> {
    if (!input.text.trim() || input.text.length > 4096 || !input.recipientId.trim() || !input.effectKey.trim()) throw new MetaWhatsAppOutboundError("Outbound Meta message is invalid.", "PROVIDER_PAYLOAD_REJECTED");
    if (this.bindings.GHL_META_WHATSAPP_OUTBOUND_ENABLED !== "true") throw new MetaWhatsAppOutboundError("Meta WhatsApp outbound messaging is disabled.", "META_OUTBOUND_DISABLED");
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection) throw new MetaWhatsAppOutboundError("Meta connection is unavailable.", "META_CONNECTION_UNAVAILABLE");
    if (connection.status !== "active") throw new MetaWhatsAppOutboundError("Meta connection is disabled.", "META_CONNECTION_DISABLED");
    if (!await isMetaConnectionEligible(this.db, this.bindings, input.tenantId, input.connectionId)) throw new MetaWhatsAppOutboundError("Meta connection is not activated.", "META_CONNECTION_DISABLED");
    const conversation = await this.db.prepare(`SELECT 1 FROM messaging_conversations WHERE id=? AND tenant_id=? AND provider='meta_whatsapp' AND connection_id=? AND external_participant_id=?`).bind(input.conversationId,input.tenantId,input.connectionId,input.recipientId).first();
    if (!conversation) throw new MetaWhatsAppOutboundError("Meta conversation is not authorized for this recipient.", "META_CONVERSATION_NOT_UNIQUE");
    const lastInbound = await this.db.prepare(`SELECT occurred_at FROM messaging_messages WHERE tenant_id=? AND conversation_id=? AND provider='meta_whatsapp' AND direction='inbound' AND content_type='text' ORDER BY occurred_at DESC LIMIT 1`).bind(input.tenantId,input.conversationId).first<{occurred_at:string}>();
    const inboundAt = lastInbound ? Date.parse(lastInbound.occurred_at) : Number.NaN;
    const now = this.now();
    if (!Number.isFinite(inboundAt) || inboundAt > now || now - inboundAt > 24*60*60*1000) throw new MetaWhatsAppOutboundError("The customer-service messaging window is not eligible.", "META_CUSTOMER_WINDOW_EXPIRED");
    const payloadHash = await hash(JSON.stringify({ connectionId: input.connectionId, conversationId: input.conversationId, recipientId: input.recipientId, text: input.text }));
    const legacyPayloadHash = await hash(input.text);
    const existing=await this.db.prepare(`SELECT id, status, provider_message_id, payload_hash, last_error_code, retry_after_at, conversation_id, connection_id, recipient_id FROM messaging_outbound_deliveries WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(input.tenantId,input.effectKey,input.effectKey).first<{id:string;status:string;provider_message_id:string|null;payload_hash:string;last_error_code:string|null;retry_after_at:string|null;conversation_id:string|null;connection_id:string|null;recipient_id:string|null}>();
    let deliveryId: string;
    if (existing) {
      if (!matchesPayloadHash(existing, input, payloadHash, legacyPayloadHash)) throw new MetaWhatsAppOutboundError("The idempotency key was already used for a different message.");
      if (existing.status === "sent" && existing.provider_message_id) {
        await this.persistCanonical(input, existing.id);
        return {state:"accepted",providerMessageId:existing.provider_message_id};
      }
      const retryableProviderRejection = existing.status === "failed" &&
        existing.last_error_code === "provider_http_429";
      if (!retryableProviderRejection) {
        await this.persistCanonical(input, existing.id);
        return existing.status === "failed"
          ? {state:"permanent",code:"duplicate_effect"}
          : {state:"unknown",code:"duplicate_effect"};
      }
      const retryAt = existing.retry_after_at ? Date.parse(existing.retry_after_at) : Number.NaN;
      if (Number.isFinite(retryAt) && retryAt > now) {
        return { state: "retryable", code: "provider_http_429", retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
      }
      const reclaimed = await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status='sending',attempt_count=attempt_count+1,retry_after_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status='failed' AND last_error_code='provider_http_429' AND (retry_after_at IS NULL OR retry_after_at<=?)`).bind(existing.id,input.tenantId,new Date(now).toISOString()).run();
      if ((reclaimed.meta?.changes ?? 0) !== 1) return {state:"unknown",code:"duplicate_effect"};
      deliveryId = existing.id;
    } else {
      deliveryId = crypto.randomUUID();
      const reserved=await this.db.prepare(`INSERT INTO messaging_outbound_deliveries (id,tenant_id,event_id,provider,effect_key,conversation_id,payload_hash,status,attempt_count,connection_id,recipient_id) VALUES (?,?,?,?,?,?,?,'sending',1,?,?) ON CONFLICT(tenant_id,event_id,effect_key) DO NOTHING`).bind(deliveryId,input.tenantId,input.effectKey,"meta_whatsapp",input.effectKey,input.conversationId,payloadHash,input.connectionId,input.recipientId).run();
      if ((reserved.meta?.changes??0)!==1) {
        const duplicate = await this.db.prepare(`SELECT id, payload_hash, conversation_id, connection_id, recipient_id FROM messaging_outbound_deliveries WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(input.tenantId,input.effectKey,input.effectKey).first<{id:string;payload_hash:string;conversation_id:string|null;connection_id:string|null;recipient_id:string|null}>();
        if (duplicate) {
          if (!matchesPayloadHash(duplicate, input, payloadHash, legacyPayloadHash)) throw new MetaWhatsAppOutboundError("The idempotency key was already used for a different message.");
          await this.persistCanonical(input, duplicate.id);
        }
        return {state:"unknown",code:"duplicate_effect"};
      }
    }
    let outcome:MetaSendOutcome;
    let credentialVersion: number | undefined;
    try {
      const credential = await createMetaWhatsAppCredentialVault(this.db, this.bindings).resolve({tenantId:input.tenantId,integrationId:connection.integrationId,connectionId:connection.id,provider:"meta_whatsapp"});
      credentialVersion = credential.credentialVersion;
      outcome = await this.transport.sendText({phoneNumberId:connection.phoneNumberId,recipientId:input.recipientId,text:input.text,accessToken:credential.accessToken});
    } catch (error) {
      outcome = error instanceof MetaWhatsAppCredentialError
        ? { state: "permanent", code: error.code }
        : { state: "unknown", code: "transport_exception" };
    }
    if (outcome.state === "permanent" && outcome.code === "META_CREDENTIAL_INVALID" && credentialVersion !== undefined) {
      try {
        await createMetaWhatsAppCredentialVault(this.db, this.bindings).disable({ tenantId: input.tenantId, integrationId: connection.integrationId, connectionId: connection.id, provider: "meta_whatsapp", expectedVersion: credentialVersion });
      } catch {
        // Do not log provider or credential details. The delivery remains failed below.
      }
    }
    if(outcome.state==="accepted") await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status='sent',provider_delivery_status='accepted',provider_message_id=?,retry_after_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(outcome.providerMessageId,input.tenantId,input.effectKey,input.effectKey).run();
    else if (outcome.state === "retryable") {
      const retryAfterSeconds = Math.max(1, Math.min(86_400, Math.floor(outcome.retryAfterSeconds ?? 30)));
      const retryAfterAt = new Date(this.now() + retryAfterSeconds * 1000).toISOString();
      await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status='failed',last_error_code=?,retry_after_at=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(outcome.code, retryAfterAt, input.tenantId, input.effectKey, input.effectKey).run();
      outcome = { ...outcome, retryAfterSeconds };
    } else await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status=?,last_error_code=?,retry_after_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(outcome.state==="unknown"?"unknown":"failed",formatMetaTransportErrorCode(outcome.code, outcome.state === "unknown" ? outcome.transportCategory : undefined),input.tenantId,input.effectKey,input.effectKey).run();
    await this.persistCanonical(input, deliveryId);
    return outcome;
  }
  private async persistCanonical(input: { tenantId: string; conversationId: string; text: string }, deliveryId: string): Promise<void> {
    await new MessagingConversationRepository(this.db).ensureOutbound({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      deliveryId,
      text: input.text,
    });
  }
  async reconcileStatus(input:{tenantId:string;connectionId:string;providerMessageId:string;status:string}):Promise<void>{
    await reconcileMetaWhatsAppStatus(this.db, input);
  }
}

function matchesPayloadHash(
  existing: { payload_hash: string; conversation_id: string | null; connection_id: string | null; recipient_id: string | null },
  input: { conversationId: string; connectionId: string; recipientId: string },
  payloadHash: string,
  legacyPayloadHash: string,
): boolean {
  return existing.payload_hash === payloadHash || (
    existing.payload_hash === legacyPayloadHash &&
    existing.conversation_id === input.conversationId &&
    existing.connection_id === input.connectionId &&
    existing.recipient_id === input.recipientId
  );
}

export function createMetaWhatsAppOutboundService(bindings: Pick<AppBindings, "DB" | "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION" | "META_WHATSAPP_GRAPH_API_VERSION" | "WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED" | "GHL_META_WHATSAPP_OUTBOUND_ENABLED">): MetaWhatsAppOutboundService {
  return new MetaWhatsAppOutboundService(
    bindings.DB,
    bindings,
    createMetaWhatsAppGraphOutboundTransport(bindings),
  );
}
export async function reconcileMetaWhatsAppStatus(db:D1Database,input:{tenantId:string;connectionId:string;providerMessageId:string;status:string}):Promise<void>{
  const rank:Record<string,number>={accepted:1,sent:2,delivered:3,read:4,failed:5}; const next=rank[input.status]; if(!next)return;
  const connection=await new MetaWhatsAppConnectionRepository(db).findByTenantAndId(input.tenantId,input.connectionId); if(!connection||connection.status!=="active")throw new MetaWhatsAppOutboundError("Meta connection is unavailable.");
  const row=await db.prepare(`SELECT id,status,provider_delivery_status FROM messaging_outbound_deliveries WHERE tenant_id=? AND provider='meta_whatsapp' AND connection_id=? AND provider_message_id=? LIMIT 1`).bind(input.tenantId,input.connectionId,input.providerMessageId).first<{id:string;status:string;provider_delivery_status:string|null}>(); if(!row)return;
  const current=rank[row.provider_delivery_status??"accepted"]??0; if(next<current)return;
  await db.prepare(`UPDATE messaging_outbound_deliveries SET status=?,provider_delivery_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).bind(input.status==="failed"?"failed":"sent",input.status,row.id,input.tenantId).run();
}
async function hash(value:string){const data=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,"0")).join("");}

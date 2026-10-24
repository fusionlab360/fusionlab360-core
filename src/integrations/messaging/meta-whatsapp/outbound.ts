import type { AppBindings } from "../../../config/app";
import { createMetaWhatsAppCredentialVault, MetaWhatsAppCredentialError } from "./credential-vault";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { MessagingConversationRepository } from "../../../persistence/repositories/messaging-conversation-repository";
import { createMetaWhatsAppGraphOutboundTransport } from "./graph-outbound-transport";

export type MetaSendOutcome = { state: "accepted"; providerMessageId: string } | { state: "retryable"; code: string } | { state: "permanent"; code: string } | { state: "unknown"; code: string };
export interface MetaWhatsAppTransport { sendText(input: { phoneNumberId: string; recipientId: string; text: string; accessToken: string }): Promise<MetaSendOutcome>; }
export class MetaWhatsAppOutboundError extends Error { constructor(message: string) { super(message); this.name = "MetaWhatsAppOutboundError"; } }

export class MetaWhatsAppOutboundService {
  constructor(private readonly db: D1Database, private readonly bindings: Pick<AppBindings, "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION">, private readonly transport: MetaWhatsAppTransport) {}
  async send(input: { tenantId: string; connectionId: string; conversationId: string; recipientId: string; text: string; effectKey: string }): Promise<MetaSendOutcome> {
    if (!input.text.trim() || input.text.length > 4096 || !input.recipientId.trim() || !input.effectKey.trim()) throw new MetaWhatsAppOutboundError("Outbound Meta message is invalid.");
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection || connection.status !== "active") throw new MetaWhatsAppOutboundError("Meta connection is unavailable.");
    const conversation = await this.db.prepare(`SELECT 1 FROM messaging_conversations WHERE id=? AND tenant_id=? AND provider='meta_whatsapp' AND connection_id=? AND external_participant_id=?`).bind(input.conversationId,input.tenantId,input.connectionId,input.recipientId).first();
    if (!conversation) throw new MetaWhatsAppOutboundError("Meta conversation is not authorized for this recipient.");
    const lastInbound = await this.db.prepare(`SELECT occurred_at FROM messaging_messages WHERE tenant_id=? AND conversation_id=? AND direction='inbound' AND content_type='text' ORDER BY occurred_at DESC LIMIT 1`).bind(input.tenantId,input.conversationId).first<{occurred_at:string}>();
    if (!lastInbound || Date.now()-Date.parse(lastInbound.occurred_at)>24*60*60*1000) throw new MetaWhatsAppOutboundError("The customer-service messaging window is not eligible.");
    const payloadHash = await hash(input.text);
    const existing=await this.db.prepare(`SELECT id, status, provider_message_id, payload_hash FROM messaging_outbound_deliveries WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(input.tenantId,input.effectKey,input.effectKey).first<{id:string;status:string;provider_message_id:string|null;payload_hash:string}>();
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new MetaWhatsAppOutboundError("The idempotency key was already used for a different message.");
      const outcome: MetaSendOutcome = existing.status === "sent" && existing.provider_message_id
        ? {state:"accepted",providerMessageId:existing.provider_message_id}
        : existing.status === "failed" ? {state:"permanent",code:"duplicate_effect"} : {state:"unknown",code:"duplicate_effect"};
      await this.persistCanonical(input, existing.id);
      return outcome;
    }
    const deliveryId = crypto.randomUUID();
    const reserved=await this.db.prepare(`INSERT INTO messaging_outbound_deliveries (id,tenant_id,event_id,provider,effect_key,conversation_id,payload_hash,status,connection_id,recipient_id) VALUES (?,?,?,?,?,?,?,'sending',?,?) ON CONFLICT(tenant_id,event_id,effect_key) DO NOTHING`).bind(deliveryId,input.tenantId,input.effectKey,"meta_whatsapp",input.effectKey,input.conversationId,payloadHash,input.connectionId,input.recipientId).run();
    if ((reserved.meta?.changes??0)!==1) {
      const duplicate = await this.db.prepare(`SELECT id, payload_hash FROM messaging_outbound_deliveries WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(input.tenantId,input.effectKey,input.effectKey).first<{id:string;payload_hash:string}>();
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash) throw new MetaWhatsAppOutboundError("The idempotency key was already used for a different message.");
        await this.persistCanonical(input, duplicate.id);
      }
      return {state:"unknown",code:"duplicate_effect"};
    }
    let outcome:MetaSendOutcome;
    try {
      const credential = await createMetaWhatsAppCredentialVault(this.db, this.bindings).resolve({tenantId:input.tenantId,integrationId:connection.integrationId,connectionId:connection.id,provider:"meta_whatsapp"});
      outcome = await this.transport.sendText({phoneNumberId:connection.phoneNumberId,recipientId:input.recipientId,text:input.text,accessToken:credential.accessToken});
    } catch (error) {
      outcome={state:"unknown",code:error instanceof MetaWhatsAppCredentialError ? "credential_unavailable" : "transport_exception"};
    }
    if(outcome.state==="accepted") await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status='sent',provider_delivery_status='accepted',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(outcome.providerMessageId,input.tenantId,input.effectKey,input.effectKey).run();
    else await this.db.prepare(`UPDATE messaging_outbound_deliveries SET status=?,last_error_code=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND event_id=? AND effect_key=?`).bind(outcome.state==="permanent"?"failed":"unknown",outcome.code,input.tenantId,input.effectKey,input.effectKey).run();
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

export function createMetaWhatsAppOutboundService(bindings: Pick<AppBindings, "DB" | "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION" | "META_WHATSAPP_GRAPH_API_VERSION">): MetaWhatsAppOutboundService {
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

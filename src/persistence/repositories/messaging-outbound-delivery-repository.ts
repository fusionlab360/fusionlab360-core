import { BaseRepository } from "./base-repository";

export interface OutboundDeliveryPayload {
  conversationId: string;
  contactId: string;
  text: string;
  channel: string;
  channelProviderId?: string;
  replyMessageId?: string;
}

export type OutboundDeliveryReservation =
  | { state: "send"; leaseToken: string }
  | { state: "sent"; messageId: string; conversationId: string }
  | { state: "active" }
  | { state: "unknown" }
  | { state: "conflict" };

async function hashPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class MessagingOutboundDeliveryRepository extends BaseRepository {
  async reserve(input: {
    tenantId: string;
    eventId: string;
    provider: string;
    effectKey: string;
    payload: OutboundDeliveryPayload;
  }): Promise<OutboundDeliveryReservation> {
    const payload = JSON.stringify(input.payload);
    const payloadHash = await hashPayload(payload);
    const id = crypto.randomUUID();

    await this.db.prepare(`
      INSERT OR IGNORE INTO messaging_outbound_deliveries (
        id, tenant_id, event_id, provider, effect_key,
        conversation_id, payload_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      id,
      input.tenantId,
      input.eventId,
      input.provider,
      input.effectKey,
      input.payload.conversationId,
      payloadHash,
    ).run();

    const current = await this.db.prepare(`
      SELECT status, payload_hash, lease_expires_at,
             provider_message_id, provider_conversation_id
      FROM messaging_outbound_deliveries
      WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
      LIMIT 1
    `).bind(input.tenantId, input.eventId, input.effectKey).first<{
      status: "pending" | "sending" | "sent" | "failed" | "unknown";
      payload_hash: string;
      lease_expires_at: string | null;
      provider_message_id: string | null;
      provider_conversation_id: string | null;
    }>();

    if (!current) throw new Error("Outbound delivery reservation is unavailable.");
    if (current.payload_hash !== payloadHash) return { state: "conflict" };
    if (current.status === "sent") {
      if (!current.provider_message_id || !current.provider_conversation_id) {
        return { state: "unknown" };
      }
      return {
        state: "sent",
        messageId: current.provider_message_id,
        conversationId: current.provider_conversation_id,
      };
    }
    if (current.status === "unknown") return { state: "unknown" };
    if (current.status === "sending") {
      const leaseExpiry = current.lease_expires_at
        ? Date.parse(current.lease_expires_at)
        : 0;
      if (leaseExpiry > Date.now()) return { state: "active" };

      await this.db.prepare(`
        UPDATE messaging_outbound_deliveries
        SET status = 'unknown', lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = 'OUTCOME_UNCONFIRMED',
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
          AND status = 'sending'
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      `).bind(input.tenantId, input.eventId, input.effectKey, new Date().toISOString()).run();
      return { state: "unknown" };
    }

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const claimed = await this.db.prepare(`
      UPDATE messaging_outbound_deliveries
      SET status = 'sending', attempt_count = attempt_count + 1,
          lease_token = ?, lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
        AND status IN ('pending', 'failed')
    `).bind(
      leaseToken,
      leaseExpiresAt,
      input.tenantId,
      input.eventId,
      input.effectKey,
    ).run();

    return claimed.meta.changes === 1
      ? { state: "send", leaseToken }
      : { state: "active" };
  }

  async markSent(input: {
    tenantId: string;
    eventId: string;
    effectKey: string;
    leaseToken: string;
    messageId: string;
    conversationId: string;
  }): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE messaging_outbound_deliveries
      SET status = 'sent', provider_message_id = ?,
          provider_conversation_id = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
        AND status = 'sending' AND lease_token = ?
    `).bind(
      input.messageId,
      input.conversationId,
      input.tenantId,
      input.eventId,
      input.effectKey,
      input.leaseToken,
    ).run();
    return result.meta.changes === 1;
  }

  async markUnknown(input: {
    tenantId: string;
    eventId: string;
    effectKey: string;
    leaseToken: string;
    errorCode: string;
  }): Promise<void> {
    await this.db.prepare(`
      UPDATE messaging_outbound_deliveries
      SET status = 'unknown', lease_token = NULL,
          lease_expires_at = NULL, last_error_code = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
        AND status = 'sending' AND lease_token = ?
    `).bind(
      input.errorCode,
      input.tenantId,
      input.eventId,
      input.effectKey,
      input.leaseToken,
    ).run();
  }

  async markFailed(input: {
    tenantId: string;
    eventId: string;
    effectKey: string;
    leaseToken: string;
    errorCode: string;
  }): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE messaging_outbound_deliveries
      SET status = 'failed', lease_token = NULL,
          lease_expires_at = NULL, last_error_code = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND event_id = ? AND effect_key = ?
        AND status = 'sending' AND lease_token = ?
    `).bind(
      input.errorCode,
      input.tenantId,
      input.eventId,
      input.effectKey,
      input.leaseToken,
    ).run();
    return result.meta.changes === 1;
  }
}

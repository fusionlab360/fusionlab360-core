import type { Context } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { verifyMetaSignature } from "./signature";
import { parseMetaInboundText, parseMetaStatusEvents } from "./webhook";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { IntegrationEventRepository } from "../../../persistence/repositories/integration-event-repository";
import { IntegrationEventService } from "../../../core/events/service";
import type { GHLInboundQueueEnvelope } from "../../../domain/messaging/inbound-queue-contract";
import { areNewQueueEnvelopesEnabled } from "../../../domain/messaging/inbound-queue";

export async function metaWhatsAppWebhookController(c: Context<{ Bindings: AppBindings; Variables: AppVariables }>) {
  if (c.req.method === "GET") {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && token && token === c.env.META_WHATSAPP_VERIFY_TOKEN && challenge) return c.text(challenge, 200);
    return c.text("Forbidden", 403);
  }
  const rawBody = await c.req.text();
  if (!await verifyMetaSignature(rawBody, c.req.header("X-Hub-Signature-256"), c.env.META_WHATSAPP_APP_SECRET)) return c.json({ success: false, message: "Invalid webhook signature." }, 401);
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return c.json({ success: false, message: "Invalid webhook payload." }, 400); }
  if (!payload || typeof payload !== "object" || (payload as MetaWebhookPayload).object !== "whatsapp_business_account") return c.json({ success: false, message: "Unsupported webhook payload." }, 400);
  const messages = parseMetaInboundText(payload as MetaWebhookPayload);
  const statuses = parseMetaStatusEvents(payload as MetaWebhookPayload);
  const connections = new MetaWhatsAppConnectionRepository(c.env.DB);
  const events = new IntegrationEventService(new IntegrationEventRepository(c.env.DB));
  let accepted = 0;
  for (const message of messages) {
    const connection = await connections.findActiveByPhoneNumberId(message.phoneNumberId);
    if (!connection) continue;
    const result = await events.accept({
      eventId: message.providerMessageId,
      eventType: "messaging.meta_whatsapp.inbound",
      aggregateType: "message",
      aggregateId: message.providerMessageId,
      tenantId: connection.tenantId,
      provider: "meta_whatsapp",
      occurredAt: message.occurredAt,
      payload: message,
    });
    if (result.accepted && c.env.GHL_INBOUND_QUEUE && areNewQueueEnvelopesEnabled(c.env)) {
      const envelope: GHLInboundQueueEnvelope = { version: 1, kind: "meta_whatsapp", tenantId: connection.tenantId, sourceEventId: result.event.eventId };
      try { await c.env.GHL_INBOUND_QUEUE.send(envelope); } catch { /* durable event remains recoverable */ }
    }
    accepted++;
  }
  for (const status of statuses) {
    const connection = await connections.findActiveByPhoneNumberId(status.phoneNumberId);
    if (!connection) continue;
    const result = await events.accept({
      eventId: `${status.providerMessageId}:${status.status}`,
      eventType: "messaging.meta_whatsapp.status",
      aggregateType: "message",
      aggregateId: status.providerMessageId,
      tenantId: connection.tenantId,
      provider: "meta_whatsapp",
      occurredAt: status.occurredAt,
      payload: { providerMessageId: status.providerMessageId, status: status.status, phoneNumberId: status.phoneNumberId },
    });
    if (result.accepted && c.env.GHL_INBOUND_QUEUE && areNewQueueEnvelopesEnabled(c.env)) {
      try { await c.env.GHL_INBOUND_QUEUE.send({ version: 1, kind: "meta_whatsapp", tenantId: connection.tenantId, sourceEventId: result.event.eventId }); } catch { /* durable event remains recoverable */ }
    }
    accepted++;
  }
  return c.json({ success: true, accepted });
}

export type MetaWebhookPayload = { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };

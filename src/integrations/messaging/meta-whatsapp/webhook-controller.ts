import type { Context } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { verifyMetaSignature } from "./signature";
import { parseMetaInboundText, parseMetaStatusEvents } from "./webhook";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { IntegrationEventRepository } from "../../../persistence/repositories/integration-event-repository";
import { IntegrationEventService } from "../../../core/events/service";
import type { GHLInboundQueueEnvelope } from "../../../domain/messaging/inbound-queue-contract";
import { areNewQueueEnvelopesEnabled } from "../../../domain/messaging/inbound-queue";
import { isMetaWhatsAppGHLInboundEnabled } from "./gohighlevel-inbound-config";

async function enqueuePendingMetaEvent(
  events: IntegrationEventRepository,
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  tenantId: string,
  eventId: string,
  allowInitialDispatch: boolean,
): Promise<boolean> {
  const event = await events.find(tenantId, eventId);
  if (!event || event.tenantId !== tenantId || event.provider !== "meta_whatsapp") return false;
  const expiredPendingDispatch = event.lastErrorCode === "QUEUE_DISPATCH_PENDING" &&
    !!event.processingLeaseExpiresAt && event.processingLeaseExpiresAt <= new Date().toISOString();
  const recoverableDispatchFailure = event.lastErrorCode === "QUEUE_ENQUEUE_FAILED" || expiredPendingDispatch;
  if (event.processingStatus !== "received" || (!allowInitialDispatch && !recoverableDispatchFailure)) return true;
  const leaseToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const prepared = await events.prepareQueueDispatch(
    tenantId,
    eventId,
    leaseToken,
    now,
    new Date(Date.now() + 60_000).toISOString(),
    allowInitialDispatch,
  );
  if (!prepared) return true;
  if (!queue) {
    await events.failQueueDispatch(tenantId, eventId, leaseToken);
    return false;
  }
  try {
    await queue.send({ version: 1, kind: "meta_whatsapp", tenantId, sourceEventId: eventId });
  } catch {
    await events.failQueueDispatch(tenantId, eventId, leaseToken);
    return false;
  }
  try {
    await events.completeQueueDispatch(tenantId, eventId, leaseToken);
  } catch {
    // Queue acceptance is already durable. A stale dispatch marker is safe:
    // consumer-side event idempotency fences any later recovery enqueue.
  }
  return true;
}

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
  const eventRepository = new IntegrationEventRepository(c.env.DB);
  const events = new IntegrationEventService(eventRepository);
  let accepted = 0;
  let queuePublicationFailed = false;
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
    const metaDispatchEnabled = areNewQueueEnvelopesEnabled(c.env) ||
      isMetaWhatsAppGHLInboundEnabled(c.env, connection.tenantId);
    if (metaDispatchEnabled && !await enqueuePendingMetaEvent(
      eventRepository,
      c.env.GHL_INBOUND_QUEUE,
      connection.tenantId,
      result.event.eventId,
      result.accepted,
    )) {
      queuePublicationFailed = true;
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
    const metaDispatchEnabled = areNewQueueEnvelopesEnabled(c.env) ||
      isMetaWhatsAppGHLInboundEnabled(c.env, connection.tenantId);
    if (metaDispatchEnabled && !await enqueuePendingMetaEvent(
      eventRepository,
      c.env.GHL_INBOUND_QUEUE,
      connection.tenantId,
      result.event.eventId,
      result.accepted,
    )) {
      queuePublicationFailed = true;
    }
    accepted++;
  }
  if (queuePublicationFailed) {
    return c.json({ success: false, message: "Meta event queue publication could not be confirmed." }, 503);
  }
  return c.json({ success: true, accepted });
}

export type MetaWebhookPayload = { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };

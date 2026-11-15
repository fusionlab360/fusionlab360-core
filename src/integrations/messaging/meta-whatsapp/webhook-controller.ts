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
import { isMetaConnectionEligible } from "./connection-eligibility";
import { isGHLProviderPilotLocationAuthorized } from "../gohighlevel/custom-provider-pilot-config";
import { GHL_META_OUTBOUND_PHONE_NUMBER_ID, GHL_META_OUTBOUND_TENANT } from "../gohighlevel/provider-outbound-meta";
import { resolveTenant } from "../../../tenants/service";
import { resolveGHLConversationProviderId } from "../gohighlevel/custom-conversation-provider";
import { decodeUtf8Body, readBoundedBody, RequestBodyTooLargeError } from "../../../core/http/bounded-body";

const MAX_META_WEBHOOK_BODY_BYTES = 10 * 1024 * 1024;

async function isOutboundStatusDispatchEnabled(env: AppBindings, tenantId: string, connectionId: string, phoneNumberId: string): Promise<boolean> {
  if (env.GHL_META_WHATSAPP_OUTBOUND_ENABLED !== "true") return false;
  if (env.WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED !== "true") {
    return tenantId === GHL_META_OUTBOUND_TENANT && phoneNumberId === GHL_META_OUTBOUND_PHONE_NUMBER_ID;
  }
  const binding = await env.DB.prepare(`SELECT ghl_location_id, ghl_provider_id FROM meta_whatsapp_connections WHERE id=? AND tenant_id=? AND phone_number_id=? AND status='active'`).bind(connectionId, tenantId, phoneNumberId).first<{ghl_location_id:string|null;ghl_provider_id:string|null}>();
  if (!binding?.ghl_provider_id?.trim() || !isGHLProviderPilotLocationAuthorized(env, binding.ghl_location_id ?? undefined)) return false;
  try {
    const tenant = await resolveTenant(env.DB, tenantId);
    return tenant.id === tenantId && tenant.integrations.crm.provider === "gohighlevel" &&
      tenant.integrations.crm.credentials.locationId.trim() === binding.ghl_location_id &&
      resolveGHLConversationProviderId(tenant) === binding.ghl_provider_id;
  } catch {
    return false;
  }
}

async function enqueuePendingMetaEvent(
  events: IntegrationEventRepository,
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  tenantId: string,
  eventId: string,
  allowInitialDispatch: boolean,
  retainConfirmation = false,
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
    await events.completeQueueDispatch(tenantId, eventId, leaseToken, retainConfirmation);
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
  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(c.req.raw, MAX_META_WEBHOOK_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return c.json({ success: false, message: "Webhook request body is too large." }, 413);
    }
    return c.json({ success: false, message: "Invalid webhook request body." }, 400);
  }
  const diagnostics = c.get("diagnostics");
  diagnostics?.emit("meta.webhook.signature", "started");
  if (!await verifyMetaSignature(rawBody, c.req.header("X-Hub-Signature-256"), c.env.META_WHATSAPP_APP_SECRET)) {
    diagnostics?.emit("meta.webhook.signature", "failed", "AUTH_FAILURE");
    return c.json({ success: false, message: "Invalid webhook signature." }, 401);
  }
  diagnostics?.emit("meta.webhook.signature", "succeeded");
  let payload: unknown;
  try { payload = JSON.parse(decodeUtf8Body(rawBody)); } catch {
    diagnostics?.emit("meta.webhook.parse", "failed", "VALIDATION_FAILED");
    return c.json({ success: false, message: "Invalid webhook payload." }, 400);
  }
  if (!payload || typeof payload !== "object" || (payload as MetaWebhookPayload).object !== "whatsapp_business_account") {
    diagnostics?.emit("meta.webhook.parse", "failed", "VALIDATION_FAILED");
    return c.json({ success: false, message: "Unsupported webhook payload." }, 400);
  }
  const messages = parseMetaInboundText(payload as MetaWebhookPayload);
  const statuses = parseMetaStatusEvents(payload as MetaWebhookPayload);
  diagnostics?.emit("meta.webhook.parse", "succeeded");
  const connections = new MetaWhatsAppConnectionRepository(c.env.DB);
  const eventRepository = new IntegrationEventRepository(c.env.DB);
  const events = new IntegrationEventService(eventRepository);
  let accepted = 0;
  let queuePublicationFailed = false;
  try {
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
    if (!await isMetaConnectionEligible(c.env.DB, c.env, connection.tenantId, connection.id)) continue;
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
    const metaDispatchEnabled = isMetaWhatsAppGHLInboundEnabled(c.env, connection.tenantId) ||
      await isOutboundStatusDispatchEnabled(c.env, connection.tenantId, connection.id, connection.phoneNumberId);
    if (metaDispatchEnabled && !await enqueuePendingMetaEvent(
      eventRepository,
      c.env.GHL_INBOUND_QUEUE,
      connection.tenantId,
      result.event.eventId,
      true,
      true,
    )) {
      queuePublicationFailed = true;
    }
    accepted++;
  }
  } catch {
    diagnostics?.emit("meta.webhook.dispatch", "failed", "INTERNAL_ERROR");
    return c.json({ success: false, message: "Meta webhook processing could not be persisted." }, 503);
  }
  diagnostics?.emit("meta.webhook.dispatch", queuePublicationFailed ? "failed" : "succeeded",
    queuePublicationFailed ? "QUEUE_OPERATION_FAILED" : undefined);
  if (queuePublicationFailed) {
    return c.json({ success: false, message: "Meta event queue publication could not be confirmed." }, 503);
  }
  return c.json({ success: true, accepted });
}

export type MetaWebhookPayload = { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };

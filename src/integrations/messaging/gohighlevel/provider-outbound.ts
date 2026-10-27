import type { Context } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { IntegrationEventService } from "../../../core/events/service";
import { IntegrationEventRepository } from "../../../persistence/repositories/integration-event-repository";
import { resolveTenantByProviderLocation } from "../../../tenants/service";
import { verifyGHLSignature } from "./signature";
import { isGHLProviderPilotLocationAuthorized } from "./custom-provider-pilot-config";

export interface GHLProviderOutboundPayload {
  contactId: string;
  locationId: string;
  messageId: string;
  type: "SMS" | "Email";
  message: string;
  phone?: string;
  emailTo?: string | string[];
  emailFrom?: string;
  html?: string;
  subject?: string;
  userId?: string;
}

export type GHLProviderOutboundContext = Context<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGHLProviderOutboundPayload(value: unknown): GHLProviderOutboundPayload | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== "SMS" && type !== "Email") return null;
  const fields = ["contactId", "locationId", "messageId", "message"];
  if (fields.some((field) => typeof value[field] !== "string" || !String(value[field]).trim())) return null;
  return {
    contactId: String(value.contactId).trim(),
    locationId: String(value.locationId).trim(),
    messageId: String(value.messageId).trim(),
    type,
    message: String(value.message),
    ...(typeof value.phone === "string" ? { phone: value.phone } : {}),
    ...(typeof value.emailTo === "string" || Array.isArray(value.emailTo) ? { emailTo: value.emailTo as string | string[] } : {}),
    ...(typeof value.emailFrom === "string" ? { emailFrom: value.emailFrom } : {}),
    ...(typeof value.html === "string" ? { html: value.html } : {}),
    ...(typeof value.subject === "string" ? { subject: value.subject } : {}),
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
  };
}

/**
 * M0 delivery seam. It deliberately has no provider side effect. A later
 * Meta delivery implementation must be added behind this boundary and remain
 * independently authorized and idempotent.
 */
export async function deliverGHLProviderOutboundMock(
  _tenantId: string,
  _payload: GHLProviderOutboundPayload,
): Promise<{ delivered: false; mode: "mock" }> {
  return { delivered: false, mode: "mock" };
}

export async function ghlProviderOutboundController(c: GHLProviderOutboundContext) {
  if (c.env.GHL_CUSTOM_PROVIDER_ENABLED !== "true") {
    return c.json({ success: false, message: "Custom provider bridge is disabled." }, 404);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("X-GHL-Signature");
  if (!(await verifyGHLSignature(rawBody, signature))) {
    return c.json({ success: false, message: "Invalid GHL webhook signature." }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, message: "Invalid JSON payload." }, 400);
  }
  const payload = parseGHLProviderOutboundPayload(parsed);
  if (!payload) return c.json({ success: false, message: "Invalid provider outbound payload." }, 400);

  if (!isGHLProviderPilotLocationAuthorized(c.env, payload.locationId)) {
    return c.json({ success: false, message: "Custom provider bridge is disabled for this location." }, 404);
  }

  let tenant;
  try {
    tenant = await resolveTenantByProviderLocation(c.env.DB, "gohighlevel", payload.locationId);
  } catch {
    return c.json({ success: false, message: "Unknown GHL location." }, 403);
  }

  const event = await new IntegrationEventService(new IntegrationEventRepository(c.env.DB)).accept({
    eventId: payload.messageId,
    eventType: "gohighlevel.provider_outbound_message",
    aggregateType: "conversation_provider_message",
    aggregateId: payload.messageId,
    tenantId: tenant.id,
    provider: "gohighlevel",
    occurredAt: new Date().toISOString(),
    payload,
  });
  const delivery = event.duplicate
    ? { delivered: false as const, mode: "mock" as const }
    : await deliverGHLProviderOutboundMock(tenant.id, payload);
  return c.json({ success: true, accepted: true, duplicate: event.duplicate, deliveryMode: delivery.mode });
}

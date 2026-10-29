import type { Context } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { IntegrationEventService } from "../../../core/events/service";
import { IntegrationEventRepository } from "../../../persistence/repositories/integration-event-repository";
import { resolveTenantByProviderLocation } from "../../../tenants/service";
import { verifyGHLSignature } from "./signature";
import { isGHLProviderPilotLocationAuthorized } from "./custom-provider-pilot-config";
import { IntegrationEventProcessingError } from "../../../core/events/errors";
import {
  deliverGHLProviderOutboundToMeta,
  GHLMetaOutboundFailure,
  isGHLMetaOutboundPilotEnabled,
} from "./provider-outbound-meta";
import type { MetaSendOutcome } from "../meta-whatsapp/outbound";

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

export interface GHLProviderOutboundControllerDependencies {
  verifySignature?: typeof verifyGHLSignature;
  resolveTenant?: typeof resolveTenantByProviderLocation;
  deliver?: (
    env: AppBindings,
    tenant: Awaited<ReturnType<typeof resolveTenantByProviderLocation>>,
    payload: GHLProviderOutboundPayload,
  ) => Promise<MetaSendOutcome>;
}

export function createGHLProviderOutboundController(
  dependencies: GHLProviderOutboundControllerDependencies = {},
) {
  return async function ghlProviderOutboundHandler(c: GHLProviderOutboundContext) {
  if (c.env.GHL_CUSTOM_PROVIDER_ENABLED !== "true") {
    return c.json({ success: false, message: "Custom provider bridge is disabled." }, 404);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("X-GHL-Signature");
  if (!(await (dependencies.verifySignature ?? verifyGHLSignature)(rawBody, signature))) {
    return c.json({ success: false, message: "Invalid GHL webhook signature." }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, message: "Invalid JSON payload." }, 400);
  }
  const payload = parseGHLProviderOutboundPayload(parsed);
  if (!payload) return c.json({ success: false, message: "Invalid provider outbound payload.", code: "PROVIDER_PAYLOAD_REJECTED" }, 400);

  if (!isGHLProviderPilotLocationAuthorized(c.env, payload.locationId)) {
    return c.json({ success: false, message: "Custom provider bridge is disabled for this location.", code: "PROVIDER_IDENTITY_REJECTED" }, 404);
  }

  let tenant;
  try {
    tenant = await (dependencies.resolveTenant ?? resolveTenantByProviderLocation)(c.env.DB, "gohighlevel", payload.locationId);
  } catch {
    return c.json({ success: false, message: "Unknown GHL location.", code: "PROVIDER_IDENTITY_REJECTED" }, 403);
  }

  const eventService = new IntegrationEventService(new IntegrationEventRepository(c.env.DB));
  const event = await eventService.accept({
    eventId: payload.messageId,
    eventType: "gohighlevel.provider_outbound_message",
    aggregateType: "conversation_provider_message",
    aggregateId: payload.messageId,
    tenantId: tenant.id,
    provider: "gohighlevel",
    occurredAt: new Date().toISOString(),
    payload,
  });
  if (!isGHLMetaOutboundPilotEnabled(c.env)) {
    const delivery = event.duplicate
      ? { delivered: false as const, mode: "mock" as const }
      : await deliverGHLProviderOutboundMock(tenant.id, payload);
    return c.json({ success: true, accepted: true, duplicate: event.duplicate, deliveryMode: delivery.mode });
  }

  const claim = await eventService.claimForProcessing(tenant.id, event.event.eventId);
  if (claim.state === "processed") {
    return c.json({ success: true, accepted: true, duplicate: true, deliveryMode: "meta" });
  }
  if (claim.state === "active") {
    return c.json({ success: true, accepted: true, duplicate: true, deliveryMode: "meta", deliveryState: "processing" }, 202);
  }
  if (claim.state !== "claimed") {
    return c.json({ success: false, accepted: true, duplicate: event.duplicate, deliveryMode: "meta", deliveryState: claim.state }, 409);
  }

  try {
    const outcome = await (dependencies.deliver ?? deliverGHLProviderOutboundToMeta)(c.env, tenant, payload);
    if (outcome.state === "accepted" || outcome.state === "unknown") {
      await eventService.markProcessed(tenant.id, event.event.eventId, claim.leaseToken);
      return c.json({
        success: outcome.state === "accepted",
        accepted: true,
        duplicate: event.duplicate,
        deliveryMode: "meta",
        deliveryState: outcome.state,
        ...(outcome.state === "unknown" ? { code: outcome.code } : {}),
      }, outcome.state === "accepted" ? 200 : 202);
    }
    const retryable = outcome.state === "retryable";
    await eventService.markFailed(tenant.id, event.event.eventId, new IntegrationEventProcessingError({
      code: retryable ? "PROVIDER_TRANSIENT" : "PROVIDER_REQUEST_REJECTED",
      severity: "error",
      message: retryable ? "Meta outbound delivery was rejected transiently." : "Meta outbound delivery was rejected permanently.",
      retryable,
    }), claim.leaseToken);
    return c.json({ success: false, accepted: true, duplicate: event.duplicate, deliveryMode: "meta", deliveryState: outcome.state }, retryable ? 503 : 422);
  } catch (error) {
    const failure = error instanceof GHLMetaOutboundFailure ? error : null;
    await eventService.markFailed(tenant.id, event.event.eventId, new IntegrationEventProcessingError({
      code: failure?.code ?? "PROVIDER_REQUEST_REJECTED",
      severity: "error",
      message: failure?.message ?? "The signed GHL provider reply was not authorized for Meta delivery.",
      retryable: failure?.retryable ?? false,
    }), claim.leaseToken);
    return c.json({ success: false, accepted: true, duplicate: event.duplicate, deliveryMode: "meta", deliveryState: "rejected", code: failure?.code ?? "PROVIDER_REQUEST_REJECTED" }, failure?.retryable ? 503 : 422);
  }
  };
}

export const ghlProviderOutboundController = createGHLProviderOutboundController();

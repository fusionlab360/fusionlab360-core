import { ghlFetchAuthenticated } from "../../crm/gohighlevel/client";
import { ApiError } from "../../../core/errors/ApiError";
import { logger } from "../../../core/logger";
import type { IntegrationContext } from "../../../context/integration";
import type { Tenant } from "../../../tenants/types";
import {
  requireGHLProviderPilotLocation,
  type GHLCustomProviderPilotConfiguration,
} from "./custom-provider-pilot-config";

export interface GHLCustomInboundMessage {
  contactId: string;
  message: string;
  conversationProviderId: string;
  conversationId?: string;
  altId?: string;
  occurredAt?: string;
}

export interface GHLCustomInboundResponse {
  success?: boolean;
  conversationId: string;
  messageId: string;
  contactId?: string;
  dateAdded?: string;
  emailMessageId?: string;
}

export interface GHLCustomInboundFailureDiagnostics {
  upstreamHttpStatus: number | null;
  errorCategory: "upstream_http_error" | "internal_error";
  errorCode: string;
  providerRequestId: string | null;
  validationFields: string[];
}

const GHL_INBOUND_VALIDATION_FIELDS = [
  "type",
  "contactId",
  "conversationId",
  "conversationProviderId",
  "message",
  "direction",
  "altId",
  "date",
] as const;

function safeDiagnosticField(
  details: unknown,
  keys: readonly string[],
  pattern: RegExp,
): string | null {
  const records: Record<string, unknown>[] = [];
  if (details && typeof details === "object" && !Array.isArray(details)) {
    records.push(details as Record<string, unknown>);
    const nested = (details as Record<string, unknown>).error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      records.push(nested as Record<string, unknown>);
    }
  }

  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && pattern.test(value)) return value;
    }
  }

  return null;
}

function safeValidationFields(details: unknown): string[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const root = details as Record<string, unknown>;
  const records = [root];
  if (root.error && typeof root.error === "object" && !Array.isArray(root.error)) {
    records.push(root.error as Record<string, unknown>);
  }

  const candidateText: string[] = [];
  const candidateFields = new Set<string>();
  for (const record of records) {
    for (const key of ["message", "errors", "details"]) {
      const value = record[key];
      if (typeof value === "string") candidateText.push(value);
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") candidateText.push(item);
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const field of Object.keys(value)) candidateFields.add(field);
      }
    }
  }

  return GHL_INBOUND_VALIDATION_FIELDS.filter((field) =>
    candidateFields.has(field) ||
    (field !== "message" && candidateText.some((candidate) =>
      new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`).test(candidate))),
  );
}

/** Extract only bounded provider diagnostics; never expose body text or headers. */
export function getGHLCustomInboundFailureDiagnostics(
  error: unknown,
): GHLCustomInboundFailureDiagnostics {
  const upstreamHttpStatus = error instanceof ApiError ? error.status : null;
  const details = error instanceof ApiError ? error.details : undefined;
  const providerErrorCode = safeDiagnosticField(
    details,
    ["code", "errorCode", "error_code"],
    /^[A-Za-z0-9_.:-]{1,64}$/,
  );
  const providerRequestId = safeDiagnosticField(
    details,
    ["requestId", "request_id", "traceId", "trace_id"],
    /^[A-Za-z0-9_.:-]{1,128}$/,
  );

  return {
    upstreamHttpStatus,
    errorCategory: upstreamHttpStatus === null
      ? "internal_error"
      : "upstream_http_error",
    errorCode: providerErrorCode ?? (upstreamHttpStatus === null ? "UNKNOWN" : `HTTP_${upstreamHttpStatus}`),
    providerRequestId,
    validationFields: safeValidationFields(details),
  };
}

const CONVERSATION_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Conversation-provider IDs are opaque HighLevel identifiers. Keep the
 * accepted syntax narrow enough to reject malformed configuration while not
 * imposing a tenant-specific ID format.
 */
export function normalizeGHLConversationProviderId(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return CONVERSATION_PROVIDER_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function resolveGHLConversationProviderId(tenant: Tenant): string {
  const configuration = tenant.integrations.crm.configuration?.providerConfiguration;
  const value = configuration?.conversationProviderId ?? configuration?.providerId;
  const conversationProviderId = normalizeGHLConversationProviderId(value);
  if (!conversationProviderId) {
    throw new Error("GHL Custom Conversation Provider is not configured for this tenant.");
  }
  return conversationProviderId;
}

export async function publishGHLCustomInboundForTenant(
  context: IntegrationContext,
  input: Omit<GHLCustomInboundMessage, "conversationProviderId">,
  pilotConfiguration: GHLCustomProviderPilotConfiguration,
): Promise<GHLCustomInboundResponse> {
  requireGHLProviderPilotLocation(
    pilotConfiguration,
    context.tenant.integrations.crm.credentials.locationId,
  );
  return publishGHLCustomInbound(context, {
    ...input,
    conversationProviderId: resolveGHLConversationProviderId(context.tenant),
  }, pilotConfiguration);
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

/** Publish a canonical inbound message to a tenant's GHL Custom provider. */
async function publishGHLCustomInbound(
  context: IntegrationContext,
  input: GHLCustomInboundMessage,
  pilotConfiguration: GHLCustomProviderPilotConfiguration,
): Promise<GHLCustomInboundResponse> {
  requireGHLProviderPilotLocation(
    pilotConfiguration,
    context.tenant.integrations.crm.credentials.locationId,
  );
  const body: Record<string, unknown> = {
    type: "SMS",
    direction: "inbound",
    contactId: required(input.contactId, "contactId"),
    message: required(input.message, "message"),
    conversationProviderId: required(input.conversationProviderId, "conversationProviderId"),
  };
  if (input.conversationId?.trim()) body.conversationId = input.conversationId.trim();
  if (input.altId?.trim()) body.altId = input.altId.trim();
  if (input.occurredAt?.trim()) body.date = input.occurredAt.trim();

  let response: GHLCustomInboundResponse;
  try {
    response = await ghlFetchAuthenticated<GHLCustomInboundResponse>(
      context,
      "/conversations/messages/inbound",
      {
        method: "POST",
        headers: { Version: "2023-02-21" },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    const diagnostics = getGHLCustomInboundFailureDiagnostics(error);
    logger.error("GHL Custom Conversation Provider inbound publish failed", {
      tenantId: context.tenant.id,
      operation: "gohighlevel.custom_conversation_provider.inbound_publish",
      ...diagnostics,
    });
    throw error;
  }
  if (!response?.conversationId || !response.messageId) {
    throw new Error("GoHighLevel did not return inbound conversation and message identifiers.");
  }
  return response;
}

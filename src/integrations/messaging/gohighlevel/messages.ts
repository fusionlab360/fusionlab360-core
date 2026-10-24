import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";
import { ApiError } from "../../../core/errors/ApiError";


import type {
  IntegrationContext,
} from "../../../context/integration";


export interface GHLConversationMessage {

  id:
    string;

  altId?:
    string;

  contactId:
    string;

  conversationId:
    string;

  locationId:
    string;

  body?:
    string;

  direction?:
    string;

  dateAdded?:
    string;

  dateUpdated?:
    string;

  messageType?:
    string;

  type?:
    number;

  status?:
    string;

  contentType?:
    string;

  source?:
    string;

  userId?:
    string;

  conversationProviderId?:
    string;

  chatWidgetId?:
    string;

  from?:
    string;

  to?:
    string;

  error?:
    string;

  meta?: {

    marketplace?: {

      appId?:
        string;

      appName?:
        string;
    };
  };
}


interface GHLMessagesResponse {

  messages?: {

    lastMessageId?:
      string;

    nextPage?:
      boolean;

    messages?:
      GHLConversationMessage[];
  };
}

export type GHLConversationHistoryFailureKind =
  | "provider_http"
  | "transport"
  | "timeout"
  | "cancelled"
  | "malformed_response";

/** Safe, structured failure for the GHL history boundary. */
export class GHLConversationHistoryError extends Error {
  readonly operation = "conversation_history" as const;

  constructor(
    readonly failureKind: GHLConversationHistoryFailureKind,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly providerErrorCode?: string,
  ) {
    super("GoHighLevel conversation history request failed.");
    this.name = "GHLConversationHistoryError";
  }
}

function getSafeProviderErrorCode(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined;
  for (const key of ["code", "errorCode", "error_code"]) {
    const value = details[key];
    if (typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value)) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRetryableHTTPStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}


/*
 * --------------------------------------------------
 * Get recent messages for a GHL conversation
 * --------------------------------------------------
 *
 * Authentication is resolved through the generic
 * IntegrationContext.
 *
 * This allows the GHL authenticated client to handle:
 *
 * - api_key credentials
 * - OAuth2 credentials
 * - expiry detection
 * - OAuth refresh
 * - D1 refresh locking
 * - one retry after a GHL 401
 */

export async function getConversationMessages(
  context:
    IntegrationContext,

  conversationId:
    string,

  limit =
    20,
): Promise<
  GHLConversationMessage[]
> {

  if (
    !conversationId?.trim()
  ) {

    throw new Error(
      "GoHighLevel conversationId is required.",
    );
  }


  const params =
    new URLSearchParams({

      limit:
        String(
          limit,
        ),

    });


  let response: GHLMessagesResponse;
  try {
    response = await ghlFetchAuthenticated<GHLMessagesResponse>(
      context,
      `/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
      { headers: { Version: "v3" } },
    );
  } catch (error: unknown) {
    if (error instanceof GHLConversationHistoryError) throw error;
    if (error instanceof ApiError) {
      throw new GHLConversationHistoryError(
        "provider_http",
        isRetryableHTTPStatus(error.status),
        error.status,
        getSafeProviderErrorCode(error.details),
      );
    }
    const errorName = error instanceof Error ? error.name : "";
    if (errorName === "TimeoutError") {
      throw new GHLConversationHistoryError("timeout", true);
    }
    if (errorName === "AbortError" || errorName === "CanceledError") {
      throw new GHLConversationHistoryError("cancelled", true);
    }
    // Authentication lookup and network failures are retried conservatively.
    throw new GHLConversationHistoryError("transport", true);
  }

  // The generic GHL client preserves non-JSON bodies as strings. Reject those
  // here rather than interpreting an invalid provider response as empty history.
  if (!isRecord(response)) {
    throw new GHLConversationHistoryError("malformed_response", true, 200);
  }
  if (response.messages === undefined) return [];
  if (!isRecord(response.messages)) {
    throw new GHLConversationHistoryError("malformed_response", true, 200);
  }
  const messages = response.messages.messages;
  if (messages === undefined) return [];
  if (!Array.isArray(messages) || !messages.every(isRecord)) {
    throw new GHLConversationHistoryError("malformed_response", true, 200);
  }

  return messages as unknown as GHLConversationMessage[];
}

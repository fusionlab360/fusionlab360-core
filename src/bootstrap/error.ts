import { HTTPException } from "hono/http-exception";

import { API_ERROR_CODES, ApiError } from "../core/errors/ApiError";
import { logger } from "../core/logger";

function safeApiErrorMessage(status: number): string {
  if (status === 400 || status === 422) return "Invalid request.";
  if (status === 401) return "Authentication required.";
  if (status === 403) return "Access denied.";
  if (status === 404) return "Not found.";
  if (status === 409) return "Request conflicts with current state.";
  if (status === 429) return "Too many requests.";
  if (status >= 500) return "Internal Server Error";
  return "Request could not be completed.";
}

export function handleError(
  error: unknown,
  requestContext?: unknown,
  hasStructuredErrorLog = false,
): Response {
  const requestCorrelationId = typeof requestContext === "string" ? requestContext : undefined;
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (error instanceof ApiError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
    const code = (API_ERROR_CODES as readonly string[]).includes(error.code)
      ? error.code
      : "API_ERROR";
    const correlationId = requestCorrelationId ?? crypto.randomUUID();

    // ApiError.details and message may contain provider payloads, credentials,
    // or customer data. Only the fixed allowlist is logged and returned.
    if (!hasStructuredErrorLog) logger.error("API error", { status, code, correlationId });

    return Response.json(
      {
        success: false,
        message: safeApiErrorMessage(status),
        code,
        correlationId,
      },
      {
        status,
        headers: { "X-Correlation-ID": correlationId },
      },
    );
  }

  if (error instanceof Error) {
  // Avoid returning or logging raw provider error messages.
  // They may contain sensitive request details or credentials.
  if (!hasStructuredErrorLog) logger.error("Unhandled application error", { correlationId: requestCorrelationId });

  return Response.json(
    {
      success: false,
      message: "Internal Server Error",
    },
    {
      status: 500,
    },
  );
}

  if (!hasStructuredErrorLog) logger.error("Unknown application error", { correlationId: requestCorrelationId });

  return Response.json(
    {
      success: false,
      message: "Internal Server Error",
    },
    {
      status: 500,
    },
  );
}

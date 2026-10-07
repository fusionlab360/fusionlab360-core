import { ApiError } from "../../../core/errors/ApiError";
import { logger } from "../../../core/logger";
import { GHL } from "./config";

function extractErrorMessage(
  status: number,
  body: unknown,
): string {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }

  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }

  return `GoHighLevel API request failed (${status})`;
}

export async function ghlFetch<T>(
  apiKey: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  if (!apiKey?.trim()) {
    throw new Error("Missing GoHighLevel API key.");
  }

  const url = `${GHL.BASE_URL}${endpoint}`;
  const method = options.method ?? "GET";

  logger.debug("Sending GHL request", {
    url,
    method,
  });

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      Version: GHL.API_VERSION,
      ...(options.body && !(options.body instanceof FormData)
        ? {
            "Content-Type": "application/json",
          }
        : {}),
      ...(options.headers ?? {}),
    },
  });

  const raw = await response.text();

  let body: unknown = null;

  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  logger.debug("Received GHL response", {
    url,
    method,
    status: response.status,
  });

  if (!response.ok) {
    const message = extractErrorMessage(
      response.status,
      body,
    );

    logger.error("GoHighLevel request failed", {
      url,
      method,
      status: response.status,
      response: body,
    });

    throw new ApiError(
      response.status,
      message,
      body,
    );
  }

  logger.info("GoHighLevel request completed", {
    url,
    method,
    status: response.status,
  });

  return body as T;
}
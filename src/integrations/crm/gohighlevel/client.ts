import { ApiError } from "../../../core/errors/ApiError";
import { logger } from "../../../core/logger";
import { GHL } from "./config";

export async function ghlFetch<T>(
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GHL.BASE_URL}${endpoint}`;

  logger.debug("Sending GHL request", {
    url,
    method: options.method ?? "GET",
    body: options.body,
  });

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      Version: GHL.API_VERSION,
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers ?? {}),
    },
  });

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    try {
      body = await response.text();
    } catch {
      body = null;
    }
  }

  logger.debug("Received GHL response", {
    url,
    status: response.status,
  });

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `GoHighLevel API request failed (${response.status})`;

    logger.error("GHL request failed", {
      url,
      status: response.status,
      message,
      body,
    });

    throw new ApiError(response.status, message, body);
  }

  logger.info("GHL request completed", {
    url,
    status: response.status,
  });

  return body as T;
}
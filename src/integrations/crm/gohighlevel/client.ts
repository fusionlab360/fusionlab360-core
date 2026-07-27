import { ApiError } from "../../../core/errors/ApiError";
import { GHL } from "./config";

export async function ghlFetch<T>(
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GHL.BASE_URL}${endpoint}`;

  console.log("========== GHL REQUEST ==========");
  console.log("URL:", url);
  console.log("Method:", options.method);
  console.log("Body:", options.body);

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

  console.log("Status:", response.status);

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

  console.log("========== GHL RESPONSE ==========");
  console.log("Response Body:", body);

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `GoHighLevel API request failed (${response.status})`;

    throw new ApiError(response.status, message, body);
  }

  return body as T;
}
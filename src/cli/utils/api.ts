import { CLI_CONFIG } from "../config";

export async function apiRequest<T>(
  endpoint: string,
  method: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {

  const response = await fetch(
  `${CLI_CONFIG.api.baseUrl}${endpoint}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}
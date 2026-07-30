import { ghlFetch } from "./client";
import { GHL } from "./config";
import type { GHLCustomField } from "./types";

export function getCustomFields(
  apiKey: string,
  locationId: string
) {
  const endpoint =
    `${GHL.ENDPOINTS.CUSTOM_FIELDS}?locationId=${encodeURIComponent(locationId)}`;

  console.log("CUSTOM FIELDS ENDPOINT:", endpoint);

  return ghlFetch<{
    customFields: GHLCustomField[];
  }>(
    apiKey,
    endpoint
  );
}
import { ghlFetch } from "./client";
import { GHL } from "./config";
import type { GHLCustomField } from "./types";

export function getCustomFields(
  apiKey: string,
  locationId: string
) {
  return ghlFetch<{
    customFields: GHLCustomField[];
  }>(
    apiKey,
    `${GHL.ENDPOINTS.CUSTOM_FIELDS}?locationId=${encodeURIComponent(locationId)}`
  );
}
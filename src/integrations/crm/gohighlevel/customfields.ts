import { logger } from "../../../core/logger";

import { ghlFetch } from "./client";
import { GHL } from "./config";
import type { GHLCustomField } from "./types";

export type GHLCustomFieldModel =
  | "contact"
  | "opportunity";

/**
 * Fetch GoHighLevel custom fields.
 *
 * Supports both Contact and Opportunity models.
 */
export async function getCustomFields(
  apiKey: string,
  locationId: string,
  model: GHLCustomFieldModel = "opportunity",
): Promise<{
  customFields: GHLCustomField[];
}> {
  if (!apiKey?.trim()) {
    throw new Error("Missing GoHighLevel API key.");
  }

  if (!locationId?.trim()) {
    throw new Error("Missing GoHighLevel location ID.");
  }

  const endpoint =
    `${GHL.ENDPOINTS.CUSTOM_FIELDS}/${encodeURIComponent(
      locationId,
    )}/customFields?model=${model}`;

  logger.debug("Fetching GoHighLevel custom fields", {
    endpoint,
    locationId,
    model,
  });

  const response = await ghlFetch<{
    customFields?: GHLCustomField[];
  }>(
    apiKey,
    endpoint,
  );

  return {
    customFields: response.customFields ?? [],
  };
}
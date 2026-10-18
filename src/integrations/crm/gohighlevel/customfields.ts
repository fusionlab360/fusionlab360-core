import { logger } from "../../../core/logger";
import type { RequestContext } from "../../../context";
import { ghlFetchAuthenticated } from "./client";
import { GHL } from "./config";
import type { GHLCustomField } from "./types";

export type GHLCustomFieldModel =
  | "contact"
  | "opportunity";

export async function getCustomFields(
  context: RequestContext,
  locationId: string,
  model: GHLCustomFieldModel = "opportunity",
): Promise<{ customFields: GHLCustomField[] }> {
  if (!locationId.trim()) {
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

  const response = await ghlFetchAuthenticated<{
    customFields?: GHLCustomField[];
  }>(context, endpoint);

  return {
    customFields: response.customFields ?? [],
  };
}
import { logger } from "../../../core/logger";

import { ghlFetch } from "./client";
import { GHL } from "./config";
import type { GHLCustomField } from "./types";

export function getCustomFields(
  apiKey: string,
  locationId: string,
) {
  const endpoint =
    `${GHL.ENDPOINTS.CUSTOM_FIELDS}/${encodeURIComponent(
      locationId,
    )}/customFields?model=opportunity`;

  logger.debug("Fetching GoHighLevel custom fields", {
    endpoint,
    locationId,
  });

  return ghlFetch<{
    customFields: GHLCustomField[];
  }>(
    apiKey,
    endpoint,
  );
}
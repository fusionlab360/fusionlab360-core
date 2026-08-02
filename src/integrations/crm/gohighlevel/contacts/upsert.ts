import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";
import { logger } from "../../../../core/logger";

/**
 * Upsert a GoHighLevel contact.
 *
 * This function is intentionally transport-only.
 * Business logic, retries and error recovery belong
 * to the service/adapter layer.
 */
export async function upsertContact(
  apiKey: string,
  locationId: string,
  payload: GHLContact,
) {
  if (!apiKey?.trim()) {
    throw new Error("Missing GoHighLevel API key.");
  }

  if (!locationId?.trim()) {
    throw new Error("Missing GoHighLevel location ID.");
  }

  logger.info("FINAL GHL UPSERT PAYLOAD", {
  payload: {
    locationId,
    ...payload,
  },
});

  return ghlFetch<{ contact: GHLContact }>(
    apiKey,
    `${GHL.ENDPOINTS.CONTACTS}/upsert`,
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        ...payload,
      }),
    },
  );
}
import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";

export function upsertContact(
  apiKey: string,
  locationId: string,
  payload: GHLContact
) {
  return ghlFetch<{ contact: GHLContact }>(
    apiKey,
    `${GHL.ENDPOINTS.CONTACTS}/upsert`,
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        ...payload,
      }),
    }
  );
}
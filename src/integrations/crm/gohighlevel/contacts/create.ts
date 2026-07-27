import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";

export function createContact(
  apiKey: string,
  locationId: string,
  payload: GHLContact
) {
  return ghlFetch<{ contact: GHLContact }>(
    apiKey,
    GHL.ENDPOINTS.CONTACTS,
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        ...payload,
      }),
    }
  );
}
import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";

export function updateContact(
  apiKey: string,
  contactId: string,
  payload: Partial<GHLContact>
) {
  return ghlFetch<{ contact: GHLContact }>(
    apiKey,
    `${GHL.ENDPOINTS.CONTACTS}/${contactId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
}
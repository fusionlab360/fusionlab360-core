import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";

export function getContact(
  apiKey: string,
  contactId: string
) {
  return ghlFetch<{ contact: GHLContact }>(
    apiKey,
    `${GHL.ENDPOINTS.CONTACTS}/${contactId}`
  );
}
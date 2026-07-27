import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLContact } from "../types";

export function searchContact(
  apiKey: string,
  locationId: string,
  email: string,
) {
  const endpoint =
    `${GHL.ENDPOINTS.CONTACTS}/search/duplicate` +
    `?locationId=${encodeURIComponent(locationId)}` +
    `&email=${encodeURIComponent(email)}`;

  return ghlFetch<{
    contact?: GHLContact;
    duplicate: boolean;
  }>(
    apiKey,
    endpoint,
  );
}
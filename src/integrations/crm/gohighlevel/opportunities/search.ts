import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLOpportunity } from "../types";

export function searchOpportunity(
  apiKey: string,
  contactId: string
) {
  const endpoint =
    `${GHL.ENDPOINTS.OPPORTUNITIES}?contactId=${encodeURIComponent(contactId)}`;

  return ghlFetch<{
    opportunities?: GHLOpportunity[];
  }>(
    apiKey,
    endpoint
  );
}
import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLOpportunity } from "../types";

export function createOpportunity(
  apiKey: string,
  locationId: string,
  payload: GHLOpportunity
) {
  return ghlFetch<GHLOpportunity>(
    apiKey,
    GHL.ENDPOINTS.OPPORTUNITIES,
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        ...payload,
      }),
    }
  );
}
import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLOpportunity } from "../types";

export function upsertOpportunity(
  apiKey: string,
  locationId: string,
  payload: GHLOpportunity
) {
  return ghlFetch<{ opportunity: GHLOpportunity }>(
    apiKey,
    GHL.ENDPOINTS.OPPORTUNITIES_UPSERT,
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        ...payload,
      }),
    }
  );
}
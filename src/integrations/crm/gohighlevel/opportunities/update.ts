import { ghlFetch } from "../client";
import { GHL } from "../config";
import type { GHLOpportunity } from "../types";

export function updateOpportunity(
  apiKey: string,
  opportunityId: string,
  opportunity: Partial<GHLOpportunity>
) {
  return ghlFetch<GHLOpportunity>(
    apiKey,
    `${GHL.ENDPOINTS.OPPORTUNITIES}/${opportunityId}`,
    {
      method: "PUT",
      body: JSON.stringify(opportunity),
    }
  );
}
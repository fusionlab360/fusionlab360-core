import type { RequestContext } from "../../../../context";
import { ghlFetchAuthenticated } from "../client";

export interface GHLLLocation {
  id: string;
  companyId: string;
  name?: string;
}

export async function getGHLLLocation(
  context: RequestContext,
  locationId: string,
) {
  return ghlFetchAuthenticated<{
    location: GHLLLocation;
  }>(
    context,
    `/locations/${encodeURIComponent(locationId)}`,
  );
}
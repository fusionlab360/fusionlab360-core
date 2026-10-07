import { ghlFetch } from "../client";

export interface GHLLLocation {
  id: string;
  companyId: string;
  name?: string;
}

export async function getGHLLLocation(
  apiKey: string,
  locationId: string,
) {
  return ghlFetch<{
    location: GHLLLocation;
  }>(
    apiKey,
    `/locations/${encodeURIComponent(locationId)}`,
  );
}
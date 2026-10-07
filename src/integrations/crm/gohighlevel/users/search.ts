import { ghlFetch } from "../client";

interface GHLUser {
  id: string;
  name?: string;
  email?: string;
  locationId?: string;
  role?: string;
  status?: string;
}

interface GHLUsersSearchResponse {
  users?: GHLUser[];
}

export async function searchGHLUsers(
  apiKey: string,
  companyId: string,
  locationId: string,
) {
  return ghlFetch<GHLUsersSearchResponse>(
    apiKey,
    `/users/search?companyId=${encodeURIComponent(
      companyId,
    )}&locationId=${encodeURIComponent(
      locationId,
    )}&limit=25`,
  );
}
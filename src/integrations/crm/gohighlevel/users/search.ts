import type { RequestContext } from "../../../../context";
import { ghlFetchAuthenticated } from "../client";

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
  context: RequestContext,
  companyId: string,
  locationId: string,
) {
  return ghlFetchAuthenticated<GHLUsersSearchResponse>(
    context,
    `/users/search?companyId=${encodeURIComponent(
      companyId,
    )}&locationId=${encodeURIComponent(
      locationId,
    )}&limit=25`,
  );
}
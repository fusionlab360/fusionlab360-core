import { ghlFetch } from "../client";
import { GHL } from "../config";

export function deleteContact(
  apiKey: string,
  contactId: string
) {
  return ghlFetch<{ succeeded: boolean }>(
    apiKey,
    `${GHL.ENDPOINTS.CONTACTS}/${contactId}`,
    {
      method: "DELETE",
    }
  );
}
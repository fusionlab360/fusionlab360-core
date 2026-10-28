import { ghlFetchAuthenticated } from "../client";
import { GHL } from "../config";
import type { IntegrationContext } from "../../../../context/integration";

interface GHLContactLookupResponse {
  contacts?: Array<{
    id?: unknown;
    locationId?: unknown;
  }>;
}

/** Normalize Meta's country-code sender identifier to an E.164 number. */
export function normalizeMetaSenderPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  const digits = compact.startsWith("00")
    ? compact.slice(2)
    : compact.startsWith("+")
      ? compact.slice(1)
      : compact;
  if (!/^\d{7,15}$/.test(digits) || digits.startsWith("0")) return null;
  return `+${digits}`;
}

/** Look up one existing contact inside the tenant's configured GHL location. */
export async function lookupGHLContactByPhone(
  context: IntegrationContext,
  sender: unknown,
): Promise<string | null> {
  const locationId = context.tenant.integrations.crm.credentials.locationId.trim();
  const phone = normalizeMetaSenderPhone(sender);
  if (!locationId || !phone) return null;

  const response = await ghlFetchAuthenticated<GHLContactLookupResponse>(
    context,
    `${GHL.ENDPOINTS.CONTACTS}/lookup?locationId=${encodeURIComponent(locationId)}&phone=${encodeURIComponent(phone)}&limit=20`,
    { headers: { Version: GHL.API_VERSION } },
  );
  const contacts = Array.isArray(response?.contacts) ? response.contacts : [];
  const scoped = contacts.filter((contact) =>
    typeof contact.id === "string" && contact.id.trim() &&
    contact.locationId === locationId,
  );
  if (scoped.length !== 1) {
    if (scoped.length > 1) throw new Error("More than one GHL contact matched the Meta sender.");
    return null;
  }
  return String(scoped[0]!.id).trim();
}

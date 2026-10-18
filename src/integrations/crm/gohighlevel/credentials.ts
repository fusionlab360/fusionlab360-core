import type { Tenant } from "../../../tenants/types";

export function getGHLCredentials(
  context: { tenant: Tenant },
): { locationId: string } {
  const locationId =
    context.tenant.integrations.crm.credentials.locationId.trim();

  if (!locationId) {
    throw new Error(
      "GoHighLevel Location ID is not configured.",
    );
  }

  return { locationId };
}
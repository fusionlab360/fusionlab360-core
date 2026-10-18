import { createRepositories } from "../../persistence/factory";
import type { Tenant } from "../../tenants/types";

export function normalizeGHLRentalsBookingPageUrl(
  value: unknown,
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export async function getConfiguredGHLRentalsBookingPageUrl(
  db: D1Database,
  tenant: Tenant,
): Promise<string | null> {
  const crm = tenant.integrations.crm;

  if (crm.provider !== "gohighlevel") {
    return null;
  }

  const { configurationRepository } = createRepositories(db);

  const configuration =
    await configurationRepository.getByIntegrationId(crm.id);

  const providerConfiguration =
    configuration?.providerConfiguration;

  if (
    !providerConfiguration ||
    typeof providerConfiguration !== "object"
  ) {
    return null;
  }

  return normalizeGHLRentalsBookingPageUrl(
    (
      providerConfiguration as Record<string, unknown>
    ).rentalsBookingUrl,
  );
}
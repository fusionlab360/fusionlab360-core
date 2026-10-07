import { TenantRepository } from "../persistence/repositories/tenant-repository";
import { IntegrationRepository } from "../persistence/repositories/integration-repository";
import { CredentialRepository } from "../persistence/repositories/credential-repository";
import { ConfigurationRepository } from "../persistence/repositories/configuration-repository";
import { TenantDataLoader } from "./services/tenant-data-loader";
import type { Tenant } from "./types";

export async function resolveTenant(
  db: D1Database,
  tenantId: string,
): Promise<Tenant> {
  const loader = new TenantDataLoader(
    new TenantRepository(db),
    new IntegrationRepository(db),
    new CredentialRepository(db),
    new ConfigurationRepository(db),
  );

  const tenant = await loader.load(tenantId);

  if (tenant.status !== "active") {
    throw new Error("Tenant is inactive.");
  }

  return tenant;
}

/**
 * Resolve a Fusionlab360 tenant from an external integration
 * provider and its provider-specific location identifier.
 *
 * Example:
 *
 * provider   = "gohighlevel"
 * locationId = "xxxxxxxxxxxxxxxx"
 *
 * The location is mapped through integration_credentials
 * rather than being hard-coded in application logic.
 */
export async function resolveTenantByProviderLocation(
  db: D1Database,
  provider: string,
  locationId: string,
): Promise<Tenant> {
  const credentialRepository =
    new CredentialRepository(db);

  const tenantId =
    await credentialRepository.findTenantIdByProviderAndLocation(
      provider,
      locationId,
    );

  if (!tenantId) {
    throw new Error(
      `No tenant found for provider=${provider} location=${locationId}`,
    );
  }

  return resolveTenant(
    db,
    tenantId,
  );
}
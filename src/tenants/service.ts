import { TenantRepository } from "../persistence/repositories/tenant-repository";
import { IntegrationRepository } from "../persistence/repositories/integration-repository";
import { CredentialRepository } from "../persistence/repositories/credential-repository";
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
  );

  const tenant = await loader.load(tenantId);

  if (tenant.status !== "active") {
    throw new Error("Tenant is inactive.");
  }

  return tenant;
}
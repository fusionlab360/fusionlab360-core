import { TenantRepository } from "../../persistence/repositories/tenant-repository";
import { IntegrationRepository } from "../../persistence/repositories/integration-repository";
import { CredentialRepository } from "../../persistence/repositories/credential-repository";
import { mapTenant } from "./tenant-mapper";
import type { Tenant } from "../types";
import { ConfigurationRepository } from "../../persistence/repositories/configuration-repository";

export class TenantDataLoader {
  constructor(
  private readonly tenantRepository: TenantRepository,
  private readonly integrationRepository: IntegrationRepository,
  private readonly credentialRepository: CredentialRepository,
  private readonly configurationRepository: ConfigurationRepository,
) {}

  async load(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findById(tenantId);

    if (!tenant) {
      throw new Error("Tenant not found.");
    }

    const integrations =
      await this.integrationRepository.findByTenant(tenantId);

    const credentials =
      await this.credentialRepository.findByTenant(tenantId);

    return mapTenant(
      tenant,
      integrations,
      credentials,
    );
  }
}
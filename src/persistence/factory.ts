import { TenantRepository } from "./repositories/tenant-repository";
import { IntegrationRepository } from "./repositories/integration-repository";
import { CredentialRepository } from "./repositories/credential-repository";
import { ConfigurationRepository } from "./repositories/configuration-repository";
import { ClientRepository } from "./repositories/client-repository";

export function createRepositories(db: D1Database) {
  return {
    clientRepository: new ClientRepository(db),

    tenantRepository: new TenantRepository(db),
    integrationRepository: new IntegrationRepository(db),
    credentialRepository: new CredentialRepository(db),

    configurationRepository: new ConfigurationRepository(db),
  };
}
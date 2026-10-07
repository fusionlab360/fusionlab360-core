
import { IntegrationRepository } from "../../persistence/repositories/integration-repository";
import { CredentialRepository } from "../../persistence/repositories/credential-repository";

export class OnboardingLoader {

  constructor(
    private readonly integrationRepository: IntegrationRepository,
    private readonly credentialRepository: CredentialRepository,
  ) {}

  async load(
    tenantId: string,
  ) {

    const integrations =
      await this.integrationRepository.findByTenant(
        tenantId,
      );

    const credentials =
      await this.credentialRepository.findByTenant(
        tenantId,
      );

    const crm = integrations.find(
      (integration) =>
        integration.provider === "gohighlevel",
    );

    if (!crm) {
      throw new Error(
        "CRM integration not found.",
      );
    }

    const credential =
      credentials.find(
        (credential) =>
          credential.provider === crm.provider,
      );

    if (!credential) {
      throw new Error(
        "CRM credentials not found.",
      );
    }

    return {
      integration: crm,
      credential,
    };
  }
}
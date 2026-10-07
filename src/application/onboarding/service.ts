import type {
  ConfigureResult,
  OnboardingService,
  PreviewResult,
} from "./types";

import type { RequestContext } from "../../context";

import { resolveCRMOnboarding } from "../../core/crm/resolver";
import { createRepositories } from "../../persistence/factory";

import { OnboardingLoader } from "./loader";

import { IntegrationRepository } from "../../persistence/repositories/integration-repository";
import { CredentialRepository } from "../../persistence/repositories/credential-repository";

export class DefaultOnboardingService
  implements OnboardingService {

  async preview(
    context: RequestContext,
  ): Promise<PreviewResult> {

    const onboarding =
      resolveCRMOnboarding(
        context.tenant,
      );

    const {
      apiKey,
      locationId,
    } = context.tenant.integrations.crm.credentials;

    const metadata =
      await onboarding.preview(
        apiKey,
        locationId,
      );

    return {
      provider: metadata.provider,
      locationId: metadata.locationId,
      pipelines: metadata.pipelines,
      stages: metadata.stages,
      customFields: metadata.customFields,
    };
  }

  async configure(
  db: D1Database,
  context: RequestContext,
  pipelineId: string,
  providerOptions?: Record<string, unknown>,
): Promise<ConfigureResult> {

    const onboarding =
      resolveCRMOnboarding(
        context.tenant,
      );

    const {
      apiKey,
      locationId,
    } = context.tenant.integrations.crm.credentials;

    const configuration =
      await onboarding.configure(
        apiKey,
        locationId,
        pipelineId,
        providerOptions,
      );

    const repositories =
      createRepositories(db);

    await repositories.configurationRepository.save(
      context.tenant.integrations.crm.id,
      configuration,
    );

    return {
      configuration,
    };
  }

  async resolveOnboarding(
    db: D1Database,
    tenantId: string,
  ) {

    const loader =
      new OnboardingLoader(
        new IntegrationRepository(db),
        new CredentialRepository(db),
      );

    return loader.load(
      tenantId,
    );
  }
}

export const onboardingService =
  new DefaultOnboardingService();
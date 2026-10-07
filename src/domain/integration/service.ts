import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

import { logger } from "../../core/logger";

import { createRepositories } from "../../persistence/factory";
import { discoverIntegrationConfiguration } from "./discovery";

export async function discoverAndSaveConfiguration(
  db: D1Database,
  context: RequestContext,
): Promise<IntegrationConfiguration> {

  logger.info("Integration configuration discovery started", {
    tenantId: context.tenant.id,
    integrationId: context.tenant.integrations.crm.id,
  });

  const configuration =
    await discoverIntegrationConfiguration(context);

  logger.debug("Integration configuration discovered", {
    workflow: configuration.workflow.key,
    workflowId: configuration.workflow.providerWorkflowId,
    stages: configuration.workflow.states.length,
    attributeMappings:
      configuration.attributeMappings.length,
  });

  const repositories =
    createRepositories(db);

  logger.info("Saving integration configuration", {
    integrationId: context.tenant.integrations.crm.id,
  });

  await repositories.configurationRepository.save(
    context.tenant.integrations.crm.id,
    configuration,
  );

  logger.info("Integration configuration saved", {
    integrationId: context.tenant.integrations.crm.id,
  });

  return configuration;
}


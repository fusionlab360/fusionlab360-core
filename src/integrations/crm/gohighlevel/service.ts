import type { CRMDiscovery } from "../../../core/crm/discovery";
import type { RequestContext } from "../../../context";
import type { IntegrationConfiguration } from "../../../persistence/models/integration-configuration";

import { logger } from "../../../core/logger";

import { getMetadata, setMetadata } from "./cache";
import { resolveMetadata } from "./metadata";
import { discoverConfiguration } from "./discovery";

export const goHighLevelDiscovery: CRMDiscovery = {
  async discoverConfiguration(
    context: RequestContext,
  ): Promise<IntegrationConfiguration> {
    const crm = context.tenant.integrations.crm;

const locationId = crm.credentials.locationId;

const crmConfiguration =
  crm.configuration;

if (!crmConfiguration) {
  throw new Error(
    "CRM integration has not been configured.",
  );
}

const pipelineId =
  crmConfiguration.workflow.providerWorkflowId;

    logger.info("GHL discovery started", {
      tenantId: context.tenant.id,
      locationId,
    });

    let metadata = getMetadata(locationId);

    if (metadata) {
      logger.debug("Using cached GHL metadata", {
        locationId,
      });
    } else {
      logger.debug("Resolving GHL metadata", {
        locationId,
      });

      metadata = await resolveMetadata(
        crm.credentials.apiKey,
        locationId,
      );

      setMetadata(locationId, metadata);

      logger.debug("Cached GHL metadata", {
        locationId,
      });
    }

    const configuration = discoverConfiguration(
  metadata,
  pipelineId,
);

    logger.info("GHL discovery completed", {
      tenantId: context.tenant.id,
      workflow: configuration.workflow.key,
      attributeMappings: configuration.attributeMappings.length,
    });

    return configuration;
  },
};
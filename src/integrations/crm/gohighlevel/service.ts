import type { CRMDiscovery } from "../../../core/crm/discovery";
import type { RequestContext } from "../../../context";
import type { IntegrationConfiguration } from "../../../persistence/models/integration-configuration";

import { getMetadata, setMetadata } from "./cache";
import { resolveMetadata } from "./metadata";
import { discoverConfiguration } from "./discovery";

export const goHighLevelDiscovery: CRMDiscovery = {
  async discoverConfiguration(
    context: RequestContext,
  ): Promise<IntegrationConfiguration> {

    const crm = context.tenant.integrations.crm;
    const locationId = crm.credentials.locationId;

    let metadata = getMetadata(locationId);

    if (!metadata) {
      metadata = await resolveMetadata(
        crm.credentials.apiKey,
        locationId,
      );

      setMetadata(locationId, metadata);
    }

    return discoverConfiguration(metadata);
  },
};
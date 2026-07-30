import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface CRMDiscovery {
  discoverConfiguration(
    context: RequestContext,
  ): Promise<IntegrationConfiguration>;
}
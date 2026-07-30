import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

import { resolveCRMDiscovery } from "../../core/crm/resolver";

export async function discoverIntegrationConfiguration(
  context: RequestContext,
): Promise<IntegrationConfiguration> {
  const discovery = resolveCRMDiscovery(context.tenant);

  return discovery.discoverConfiguration(context);
}
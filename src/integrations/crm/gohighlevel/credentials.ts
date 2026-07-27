import type { RequestContext } from "../../../context";

export function getGHLCredentials(
  context: RequestContext,
) {
  const credentials = context.tenant.integrations.crm.credentials;

  return {
    ...credentials,
    apiKey: credentials.apiKey.trim(),
    locationId: credentials.locationId.trim(),
  };
}
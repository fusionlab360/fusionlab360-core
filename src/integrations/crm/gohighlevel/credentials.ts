import type {
  Tenant,
} from "../../../tenants/types";


export function getGHLCredentials(
  context: {
    tenant:
      Tenant;
  },
) {

  const credentials =
    context.tenant
      .integrations
      .crm
      .credentials;


  return {

    ...credentials,

    apiKey:
      credentials.apiKey.trim(),

    locationId:
      credentials.locationId.trim(),
  };
}
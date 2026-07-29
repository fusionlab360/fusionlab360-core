import type { TenantRecord } from "../../persistence/models/tenant";
import type { CRMProvider, PMSProvider, Tenant } from "../types";
import type { IntegrationAggregate } from "../models/integration-aggregate";

export function mapTenant(
  tenant: TenantRecord,
  integrations: IntegrationAggregate[],
): Tenant {

const crm = integrations.find(
  (aggregate) =>
    aggregate.integration.provider === "gohighlevel",
);

  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,

    integrations: {
    crm: {
  provider:
    (crm?.integration.provider ?? "gohighlevel") as CRMProvider,

  credentials: {
    apiKey:
      crm?.credentials?.apiKey ?? "",

    locationId:
      crm?.credentials?.locationId ?? "",
  },

  configuration:
    crm?.configuration ?? {
      workflow: {
        key: "reservation",
        providerWorkflowId: "",
        states: [],
      },

      attributeMappings: [],
    },
},

      pms: {
        provider: "browser" as PMSProvider,
      },
    },
  };
}
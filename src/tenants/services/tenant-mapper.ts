import type { IntegrationCredential } from "../../persistence/models/integration-credential";
import type { IntegrationRecord } from "../../persistence/models/integration";
import type { TenantRecord } from "../../persistence/models/tenant";
import type { CRMProvider, PMSProvider, Tenant } from "../types";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";


export function mapTenant(
  tenant: TenantRecord,
  integrations: IntegrationRecord[],
  credentials: IntegrationCredential[],
  configurations: Array<IntegrationConfiguration | null>,
): Tenant {
  
  const crm = integrations.find(
    (i) => i.provider === "gohighlevel",
  );

  const crmCredential = credentials.find(
    (c) => c.provider === crm?.provider,
  );

  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,

    integrations: {
      crm: {
        provider: (crm?.provider ?? "gohighlevel") as CRMProvider,

        credentials: {
          apiKey: crmCredential?.apiKey ?? "",
          locationId: crmCredential?.locationId ?? "",
        },

        configuration: {
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
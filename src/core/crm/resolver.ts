import type { CRMAdapter } from "./contracts";

import { ApiError } from "../errors/ApiError";

import type { Tenant } from "../../tenants/types";

import { goHighLevelAdapter } from "../../integrations/crm/gohighlevel";
import type { CRMDiscovery } from "./discovery";
import { goHighLevelDiscovery } from "../../integrations/crm/gohighlevel";

export function resolveCRMAdapter(
  tenant: Tenant
): CRMAdapter {
  switch (tenant.integrations.crm.provider) {
    case "gohighlevel":
      return goHighLevelAdapter;

    case "hubspot":
    case "salesforce":
    case "zoho":
      throw new ApiError(
        501,
        `${tenant.integrations.crm.provider} CRM provider is not implemented.`
      );

    default:
      throw new ApiError(
        500,
        "Unsupported CRM provider."
      );
  }
}

export function resolveCRMProvider(
  tenant: Tenant
) {
  return tenant.integrations.crm.provider;
}

export function resolveCRMDiscovery(
  tenant: Tenant
): CRMDiscovery {
  switch (tenant.integrations.crm.provider) {
    case "gohighlevel":
      return goHighLevelDiscovery;

    case "hubspot":
    case "salesforce":
    case "zoho":
      throw new ApiError(
        501,
        `${tenant.integrations.crm.provider} CRM provider is not implemented.`
      );

    default:
      throw new ApiError(
        500,
        "Unsupported CRM provider."
      );
  }
}
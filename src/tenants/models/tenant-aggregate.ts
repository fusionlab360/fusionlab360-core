import type { Tenant } from "../types";
import type { IntegrationRecord } from "../../persistence/models/integration";
import type { IntegrationCredential } from "../../persistence/models/integration-credential";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface TenantIntegration {
  integration: IntegrationRecord;
  credentials: IntegrationCredential[];
  configuration: IntegrationConfiguration | null;
}

export interface TenantAggregate {
  tenant: Tenant;
  integrations: TenantIntegration[];
}
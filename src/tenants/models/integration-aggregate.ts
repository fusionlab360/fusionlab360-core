import type { IntegrationRecord } from "../../persistence/models/integration";
import type { IntegrationCredential } from "../../persistence/models/integration-credential";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface IntegrationAggregate {
  integration: IntegrationRecord;
  credentials: IntegrationCredential | null;
  configuration: IntegrationConfiguration | null;
}
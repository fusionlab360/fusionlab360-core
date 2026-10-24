import type {
  Tenant,
} from "../tenants/types";

import type {
  IntegrationRuntime,
} from "../core/integration/runtime";
import type { PatientIdentityGateway } from "../core/booking";


export interface IntegrationContext {

  tenant:
    Tenant;

  provider:
    string;

  requestId:
    string;

  receivedAt:
    Date;

  integrationRuntime:
    IntegrationRuntime;

  patientIdentity?: PatientIdentityGateway;
}


export function createIntegrationContext(
  tenant:
    Tenant,

  provider:
    string,

  integrationRuntime:
    IntegrationRuntime,
  patientIdentity?: PatientIdentityGateway,
): IntegrationContext {

  return {
    tenant,

    provider,

    requestId:
      crypto.randomUUID(),

    receivedAt:
      new Date(),

    integrationRuntime,
    patientIdentity,
  };
}

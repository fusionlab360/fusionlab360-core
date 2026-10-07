import type {
  Tenant,
} from "../tenants/types";

import type {
  IntegrationRuntime,
} from "../core/integration/runtime";


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
}


export function createIntegrationContext(
  tenant:
    Tenant,

  provider:
    string,

  integrationRuntime:
    IntegrationRuntime,
): IntegrationContext {

  return {
    tenant,

    provider,

    requestId:
      crypto.randomUUID(),

    receivedAt:
      new Date(),

    integrationRuntime,
  };
}
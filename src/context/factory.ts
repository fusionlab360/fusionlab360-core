import type {
  APIClient,
} from "../clients/types";

import type {
  RequestContext,
} from "./types";

import type {
  Tenant,
} from "../tenants/types";

import type {
  IntegrationRuntime,
} from "../core/integration/runtime";


export function createRequestContext(
  client:
    APIClient,

  tenant:
    Tenant,

  integrationRuntime:
    IntegrationRuntime,
): RequestContext {

  return {
    client,

    tenant,

    requestId:
      crypto.randomUUID(),

    receivedAt:
      new Date(),

    integrationRuntime,
  };
}


export function createRequestContexts(
  client:
    APIClient,

  tenants:
    Tenant[],

  integrationRuntime:
    IntegrationRuntime,
): RequestContext[] {

  return tenants.map(
    (
      tenant,
    ) =>
      createRequestContext(
        client,
        tenant,
        integrationRuntime,
      ),
  );
}
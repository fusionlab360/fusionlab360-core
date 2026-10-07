import type {
  APIClient,
} from "../clients/types";

import type {
  Tenant,
} from "../tenants/types";

import type {
  IntegrationRuntime,
} from "../core/integration/runtime";


export interface RequestContext {

  client:
    APIClient;

  tenant:
    Tenant;

  requestId:
    string;

  receivedAt:
    Date;

  integrationRuntime:
    IntegrationRuntime;
}
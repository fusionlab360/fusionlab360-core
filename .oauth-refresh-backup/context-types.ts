import type { APIClient } from "../clients/types";
import type { Tenant } from "../tenants/types";

export interface RequestContext {
  client: APIClient;
  tenant: Tenant;

  requestId: string;

  receivedAt: Date;
}
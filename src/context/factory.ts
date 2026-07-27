import type { APIClient } from "../clients/types";
import type { RequestContext } from "./types";
import type { Tenant } from "../tenants/types";

export function createRequestContext(
  client: APIClient,
  tenant: Tenant,
): RequestContext {
  return {
    client,
    tenant,

    requestId: crypto.randomUUID(),

    receivedAt: new Date(),
  };
}

export function createRequestContexts(
  client: APIClient,
  tenants: Tenant[],
): RequestContext[] {
  return tenants.map((tenant) =>
    createRequestContext(client, tenant)
  );
}
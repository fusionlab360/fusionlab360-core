import type { Tenant } from "../tenants/types";

export interface IntegrationContext {
  tenant: Tenant;

  provider: string;

  requestId: string;

  receivedAt: Date;
}

export function createIntegrationContext(
  tenant: Tenant,
  provider: string,
): IntegrationContext {
  return {
    tenant,
    provider,
    requestId: crypto.randomUUID(),
    receivedAt: new Date(),
  };
}
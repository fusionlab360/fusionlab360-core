import type { Tenant } from "../types";

export class TenantAggregateBuilder {
  async build(id: string): Promise<Tenant> {
    throw new Error("Not implemented.");
  }
}
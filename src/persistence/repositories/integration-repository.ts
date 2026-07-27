import { BaseRepository } from "./base-repository";
import type { IntegrationRecord } from "../models/integration";

export class IntegrationRepository extends BaseRepository {
  async findByTenant(
    tenantId: string,
  ): Promise<IntegrationRecord[]> {

    const { results } = await this.db
      .prepare(
        `
        SELECT *
        FROM integrations
        WHERE tenant_id = ?
        AND enabled = 1
        `,
      )
      .bind(tenantId)
      .all<IntegrationRecord>();

    return (results ?? []) as IntegrationRecord[];
  }
}
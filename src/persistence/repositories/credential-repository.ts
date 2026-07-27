import { BaseRepository } from "./base-repository";
import type { IntegrationCredential } from "../models/integration-credential";

export class CredentialRepository extends BaseRepository {

  async findByTenant(
    tenantId: string,
  ): Promise<IntegrationCredential[]> {
    const { results } = await this.db
      .prepare(
        `
        SELECT *
        FROM integration_credentials
        WHERE tenant_id = ?
        `,
      )
      .bind(tenantId)
      .all();

    return (results ?? []).map((row) => ({
      tenantId: row.tenant_id as string,
      provider: row.provider as string,
      apiKey: row.api_key as string,
      locationId: row.location_id as string,
      refreshToken: row.refresh_token as string | null,
      metadata: row.metadata as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async findByTenantAndProvider(
    tenantId: string,
    provider: string,
  ): Promise<IntegrationCredential | null> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM integration_credentials
        WHERE tenant_id = ?
          AND provider = ?
        LIMIT 1
        `,
      )
      .bind(tenantId, provider)
      .first();

    if (!result) {
      return null;
    }

    return {
      tenantId: result.tenant_id as string,
      provider: result.provider as string,
      apiKey: result.api_key as string,
      locationId: result.location_id as string,
      refreshToken: result.refresh_token as string | null,
      metadata: result.metadata as string | null,
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }
}
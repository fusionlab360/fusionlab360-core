import { BaseRepository } from "./base-repository";
import type { TenantRecord } from "../models/tenant";

export class TenantRepository extends BaseRepository {
  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.db
      .prepare(
        `
        SELECT *
        FROM tenants
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(id)
      .first();

    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as "active" | "inactive",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

    async activatePendingOAuthTenant(
    tenantId: string,
    provider: string,
    locationId: string,
    companyId: string,
  ): Promise<boolean> {
    await this.db
      .prepare(
        `
        UPDATE tenants
        SET
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status IN ('inactive', 'active')
          AND EXISTS (
            SELECT 1
            FROM integrations i
            JOIN integration_credentials c
              ON c.tenant_id = i.tenant_id
             AND c.provider = i.provider
            WHERE i.tenant_id = tenants.id
              AND i.provider = ?
              AND i.enabled = 1
              AND c.auth_type = 'oauth2'
              AND c.api_key IS NOT NULL
              AND TRIM(c.api_key) <> ''
              AND c.location_id = ?
              AND json_valid(c.metadata)
              AND json_extract(c.metadata, '$.companyId') = ?
              AND json_extract(
                c.metadata,
                '$.connectionStatus'
              ) = 'connected'
          )
        `,
      )
      .bind(
        tenantId,
        provider,
        locationId,
        companyId,
      )
      .run();

    const row = await this.db
      .prepare(
        `
        SELECT 1 AS active
        FROM tenants t
        WHERE t.id = ?
          AND t.status = 'active'
          AND EXISTS (
            SELECT 1
            FROM integrations i
            JOIN integration_credentials c
              ON c.tenant_id = i.tenant_id
             AND c.provider = i.provider
            WHERE i.tenant_id = t.id
              AND i.provider = ?
              AND i.enabled = 1
              AND c.auth_type = 'oauth2'
              AND c.api_key IS NOT NULL
              AND TRIM(c.api_key) <> ''
              AND c.location_id = ?
              AND json_valid(c.metadata)
              AND json_extract(c.metadata, '$.companyId') = ?
              AND json_extract(c.metadata, '$.connectionStatus') = 'connected'
          )
        LIMIT 1
        `,
      )
      .bind(tenantId, provider, locationId, companyId)
      .first<{ active: number }>();

    return row?.active === 1;
  }

}

import { BaseRepository } from "./base-repository";
import type { IntegrationRecord } from "../models/integration";

export interface OAuthOnboardingSetup {
  tenantStatus: string;
  integrationId: string;
  provider: string;
  integrationEnabled: boolean;
  credentialAuthType: string;
  credentialHasToken: boolean;
  providerResourceId: string;
  credentialMetadata: string | null;
}

export class IntegrationRepository extends BaseRepository {
  /** Finds a tenant-owned integration, including disabled records. */
  async findByTenantAndProvider(
    tenantId: string,
    provider: string,
  ): Promise<IntegrationRecord | null> {
    const row = await this.db
      .prepare(`
        SELECT *
        FROM integrations
        WHERE tenant_id = ? AND provider = ?
        LIMIT 1
      `)
      .bind(tenantId, provider)
      .first<IntegrationRecord>();

    return row ?? null;
  }

  /** Inserts once under the schema's tenant/provider unique constraint. */
  async createIfMissing(
    integration: Pick<IntegrationRecord, "id" | "tenant_id" | "provider" | "settings">,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        INSERT INTO integrations (id, tenant_id, provider, enabled, settings)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(tenant_id, provider) DO NOTHING
      `)
      .bind(
        integration.id,
        integration.tenant_id,
        integration.provider,
        integration.settings,
      )
      .run();

    return result.meta.changes === 1;
  }

  /** Compare-and-set protects configuration from stale concurrent updates. */
  async updateTenantProviderSettings(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedSettings: string | null,
    settings: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE integrations
        SET settings = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ? AND provider = ? AND settings IS ?
      `)
      .bind(settings, tenantId, integrationId, provider, expectedSettings)
      .run();

    return result.meta.changes === 1;
  }

  /** Tenant/provider/id-scoped enabled-state transition. */
  async setTenantProviderEnabled(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedEnabled: boolean,
    enabled: boolean,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE integrations
        SET enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ? AND provider = ? AND enabled = ?
      `)
      .bind(
        enabled ? 1 : 0,
        tenantId,
        integrationId,
        provider,
        expectedEnabled ? 1 : 0,
      )
      .run();

    return result.meta.changes === 1;
  }

  /** Re-enables only a disabled record while invalidating its old verification. */
  async reenableTenantProviderUnverified(
    tenantId: string,
    integrationId: string,
    provider: string,
    expectedSettings: string | null,
    settings: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE integrations
        SET enabled = 1, settings = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ? AND provider = ?
          AND enabled = 0 AND settings IS ?
      `)
      .bind(settings, tenantId, integrationId, provider, expectedSettings)
      .run();

    return result.meta.changes === 1;
  }

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

  async findOAuthOnboardingSetup(
    tenantId: string,
    provider: string,
  ): Promise<OAuthOnboardingSetup | null> {
    const row = await this.db
      .prepare(
        `
        SELECT
          t.status AS tenant_status,
          i.id AS integration_id,
          i.provider,
          i.enabled AS integration_enabled,
          c.auth_type AS credential_auth_type,
          CASE
            WHEN c.api_key IS NOT NULL AND TRIM(c.api_key) <> ''
              THEN 1
            ELSE 0
          END AS credential_has_token,
          c.location_id,
          c.metadata AS credential_metadata
        FROM tenants t
        JOIN integrations i
          ON i.tenant_id = t.id
        LEFT JOIN integration_credentials c
          ON c.tenant_id = i.tenant_id
         AND c.provider = i.provider
        WHERE t.id = ?
          AND i.provider = ?
        LIMIT 1
        `,
      )
      .bind(tenantId, provider)
      .first<{
        tenant_status: string;
        integration_id: string;
        provider: string;
        integration_enabled: number;
        credential_auth_type: string | null;
        credential_has_token: number;
        location_id: string | null;
        credential_metadata: string | null;
      }>();

    if (
      !row ||
      !row.credential_auth_type ||
      !row.location_id
    ) {
      return null;
    }

    return {
      tenantStatus: row.tenant_status,
      integrationId: row.integration_id,
      provider: row.provider,
      integrationEnabled: row.integration_enabled === 1,
      credentialAuthType: row.credential_auth_type,
      credentialHasToken: row.credential_has_token === 1,
      providerResourceId: row.location_id,
      credentialMetadata: row.credential_metadata,
    };
  }

    async enablePendingOAuthIntegration(
    tenantId: string,
    provider: string,
    locationId: string,
    companyId: string,
  ): Promise<boolean> {
    await this.db
      .prepare(
        `
        UPDATE integrations
        SET
          enabled = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND provider = ?
          AND EXISTS (
            SELECT 1
            FROM integration_credentials c
            WHERE c.tenant_id = integrations.tenant_id
              AND c.provider = integrations.provider
              AND c.auth_type = 'oauth2'
              AND c.api_key IS NOT NULL
              AND TRIM(c.api_key) <> ''
              AND c.location_id = ?
              AND json_valid(c.metadata)
              AND json_extract(c.metadata, '$.companyId') = ?
              AND json_extract(c.metadata, '$.connectionStatus') = 'connected'
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
        SELECT 1 AS enabled
        FROM integrations i
        JOIN integration_credentials c
          ON c.tenant_id = i.tenant_id
         AND c.provider = i.provider
        WHERE i.tenant_id = ?
          AND i.provider = ?
          AND i.enabled = 1
          AND c.auth_type = 'oauth2'
          AND c.api_key IS NOT NULL
          AND TRIM(c.api_key) <> ''
          AND c.location_id = ?
          AND json_valid(c.metadata)
          AND json_extract(c.metadata, '$.companyId') = ?
          AND json_extract(c.metadata, '$.connectionStatus') = 'connected'
        LIMIT 1
        `,
      )
      .bind(tenantId, provider, locationId, companyId)
      .first<{ enabled: number }>();

    return row?.enabled === 1;
  }
}

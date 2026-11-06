/** Minimal local ownership projection for the read-only GHL page.
 * The query never selects access/refresh token values or raw OAuth metadata.
 */
export interface GHLReadonlyInstallationRecord {
  tenantId: string;
  tenantStatus: string;
  integrationEnabled: boolean;
  credentialAuthType: string;
  credentialConfigured: boolean;
  connectedMetadata: boolean;
  locationAccountMetadata: boolean;
  appMatches: boolean;
  companyMatches: boolean;
  locationMatches: boolean;
  providerIdentifier: string | null;
}

interface GHLReadonlyInstallationRow {
  tenant_id: string;
  tenant_status: string;
  integration_enabled: number;
  credential_auth_type: string;
  credential_configured: number;
  connected_metadata: number;
  location_account_metadata: number;
  app_matches: number;
  company_matches: number;
  location_matches: number;
  provider_identifier: string | null;
}

export class GHLReadonlyInstallationRepository {
  constructor(private readonly db: D1Database) {}

  async findUniqueForLocation(
    locationId: string,
    appId: string,
    companyId: string,
  ): Promise<GHLReadonlyInstallationRecord | null> {
    const result = await this.db.prepare(`
      SELECT
        tenant.id AS tenant_id,
        tenant.status AS tenant_status,
        integration.enabled AS integration_enabled,
        credential.auth_type AS credential_auth_type,
        CASE
          WHEN credential.api_key IS NOT NULL AND TRIM(credential.api_key) <> '' THEN 1
          ELSE 0
        END AS credential_configured,
        CASE
          WHEN json_valid(credential.metadata) AND json_extract(credential.metadata, '$.connectionStatus') = 'connected' THEN 1
          ELSE 0
        END AS connected_metadata,
        CASE
          WHEN json_valid(credential.metadata) AND json_extract(credential.metadata, '$.accountType') = 'location' THEN 1
          ELSE 0
        END AS location_account_metadata,
        CASE
          WHEN json_valid(credential.metadata) AND json_extract(credential.metadata, '$.appId') = ? THEN 1
          ELSE 0
        END AS app_matches,
        CASE
          WHEN json_valid(credential.metadata) AND json_extract(credential.metadata, '$.companyId') = ? THEN 1
          ELSE 0
        END AS company_matches,
        CASE
          WHEN json_valid(credential.metadata) AND json_extract(credential.metadata, '$.locationId') = ? THEN 1
          ELSE 0
        END AS location_matches,
        CASE
          WHEN json_valid(integration.settings) THEN COALESCE(
            json_extract(integration.settings, '$.providerConfiguration.conversationProviderId'),
            json_extract(integration.settings, '$.providerConfiguration.providerId')
          )
          ELSE NULL
        END AS provider_identifier
      FROM integration_credentials credential
      JOIN tenants tenant ON tenant.id = credential.tenant_id
      JOIN integrations integration
        ON integration.tenant_id = credential.tenant_id
       AND integration.provider = credential.provider
      WHERE credential.provider = 'gohighlevel'
        AND credential.auth_type = 'oauth2'
        AND TRIM(credential.location_id) = ?
      LIMIT 2
    `).bind(appId, companyId, locationId, locationId).all<GHLReadonlyInstallationRow>();

    const rows = result.results ?? [];
    if (rows.length > 1) throw new Error("GHL location ownership is ambiguous.");
    const row = rows[0];
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      tenantStatus: row.tenant_status,
      integrationEnabled: row.integration_enabled === 1,
      credentialAuthType: row.credential_auth_type,
      credentialConfigured: row.credential_configured === 1,
      connectedMetadata: row.connected_metadata === 1,
      locationAccountMetadata: row.location_account_metadata === 1,
      appMatches: row.app_matches === 1,
      companyMatches: row.company_matches === 1,
      locationMatches: row.location_matches === 1,
      providerIdentifier: row.provider_identifier,
    };
  }
}

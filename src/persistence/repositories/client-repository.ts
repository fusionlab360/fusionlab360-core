import { BaseRepository } from "./base-repository";
import type { ClientRecord } from "../models/client";

export class ClientRepository extends BaseRepository {
  async findById(
    id: string,
  ): Promise<ClientRecord | undefined> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM clients
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(id)
      .first<ClientRecord>();

    return result ?? undefined;
  }

  async findByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<ClientRecord | undefined> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM clients
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
        `,
      )
      .bind(tenantId, id)
      .first<ClientRecord>();

    return result ?? undefined;
  }

  async updatePermissions(
    tenantId: string,
    id: string,
    expectedPermissions: string,
    permissions: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `
        UPDATE clients
        SET permissions = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ? AND permissions = ?
        `,
      )
      .bind(permissions, tenantId, id, expectedPermissions)
      .run();

    return result.meta.changes === 1;
  }

  async findByApiKeyHash(
    apiKeyHash: string,
  ): Promise<ClientRecord | undefined> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM clients
        WHERE api_key_hash = ?
        LIMIT 1
        `,
      )
      .bind(apiKeyHash)
      .first<ClientRecord>();

    return result ?? undefined;
  }

    async markPendingOAuthCredentialConnected(
    tenantId: string,
    provider: string,
    locationId: string,
    companyId: string,
  ): Promise<boolean> {
    await this.db
      .prepare(
        `
        UPDATE integration_credentials
        SET
          metadata = json_set(
            metadata,
            '$.connectionStatus',
            'connected'
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND provider = ?
          AND auth_type = 'oauth2'
          AND api_key IS NOT NULL
          AND TRIM(api_key) <> ''
          AND location_id = ?
          AND json_valid(metadata)
          AND json_extract(metadata, '$.companyId') = ?
          AND json_extract(
            metadata,
            '$.connectionStatus'
          ) = 'pending_oauth'
          AND EXISTS (
            SELECT 1
            FROM integrations i
            JOIN tenants t ON t.id = i.tenant_id
            WHERE i.tenant_id = integration_credentials.tenant_id
              AND i.provider = integration_credentials.provider
              AND i.enabled = 1
              AND t.status = 'active'
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
        SELECT metadata
        FROM integration_credentials
        WHERE tenant_id = ?
          AND provider = ?
          AND auth_type = 'oauth2'
          AND api_key IS NOT NULL
          AND TRIM(api_key) <> ''
          AND location_id = ?
          AND json_valid(metadata)
          AND json_extract(metadata, '$.companyId') = ?
          AND json_extract(
            metadata,
            '$.connectionStatus'
          ) = 'connected'
        LIMIT 1
        `,
      )
      .bind(
        tenantId,
        provider,
        locationId,
        companyId,
      )
      .first();

    return Boolean(row);
  }
}

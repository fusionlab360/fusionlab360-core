import { BaseRepository } from "../../../../persistence/repositories/base-repository";
import type {
  MetaWhatsAppCredentialRecord,
  MetaWhatsAppCredentialStatus,
} from "./credential-model";

export interface MetaWhatsAppCredentialOwner {
  tenantId: string;
  integrationId: string;
  connectionId: string;
}

export interface NewMetaWhatsAppCredential extends MetaWhatsAppCredentialOwner {
  id: string;
  ciphertext: string;
  nonce: string;
  algorithm: "AES-GCM";
  keyVersion: string;
  metadata: string;
}

export interface ReplacedMetaWhatsAppCredential extends Omit<NewMetaWhatsAppCredential, "id"> {
  expectedVersion: number;
}

function mapRow(row: Record<string, unknown>): MetaWhatsAppCredentialRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    integrationId: String(row.integration_id),
    connectionId: String(row.connection_id),
    provider: "meta_whatsapp",
    status: row.status as MetaWhatsAppCredentialStatus,
    ciphertext: typeof row.ciphertext === "string" ? row.ciphertext : null,
    nonce: typeof row.nonce === "string" ? row.nonce : null,
    algorithm: "AES-GCM",
    keyVersion: String(row.key_version),
    credentialVersion: Number(row.credential_version),
    metadata: String(row.metadata),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class MetaWhatsAppCredentialRepository extends BaseRepository {
  async create(input: NewMetaWhatsAppCredential): Promise<boolean> {
    const result = await this.db.prepare(`
      INSERT INTO meta_whatsapp_credentials (
        id, tenant_id, integration_id, connection_id, provider, status,
        ciphertext, nonce, algorithm, key_version, credential_version, metadata
      )
      SELECT ?, ?, ?, ?, 'meta_whatsapp', 'active', ?, ?, ?, ?, 1, ?
      WHERE EXISTS (
        SELECT 1
        FROM meta_whatsapp_connections c
        JOIN integrations i ON i.id = c.integration_id
        WHERE c.id = ?
          AND c.tenant_id = ?
          AND c.integration_id = ?
          AND i.tenant_id = ?
          AND i.provider = 'meta_whatsapp'
      )
      ON CONFLICT(connection_id) DO NOTHING
    `).bind(
      input.id,
      input.tenantId,
      input.integrationId,
      input.connectionId,
      input.ciphertext,
      input.nonce,
      input.algorithm,
      input.keyVersion,
      input.metadata,
      input.connectionId,
      input.tenantId,
      input.integrationId,
      input.tenantId,
    ).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async findActiveForOwner(owner: MetaWhatsAppCredentialOwner): Promise<MetaWhatsAppCredentialRecord | null> {
    const row = await this.db.prepare(`
      SELECT credential.*
      FROM meta_whatsapp_credentials credential
      JOIN meta_whatsapp_connections connection
        ON connection.id = credential.connection_id
      JOIN integrations integration
        ON integration.id = credential.integration_id
      WHERE credential.tenant_id = ?
        AND credential.integration_id = ?
        AND credential.connection_id = ?
        AND credential.provider = 'meta_whatsapp'
        AND credential.status = 'active'
        AND connection.tenant_id = credential.tenant_id
        AND connection.integration_id = credential.integration_id
        AND connection.status = 'active'
        AND integration.tenant_id = credential.tenant_id
        AND integration.provider = credential.provider
      LIMIT 1
    `).bind(owner.tenantId, owner.integrationId, owner.connectionId).first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  }

  async findForOwner(owner: MetaWhatsAppCredentialOwner): Promise<MetaWhatsAppCredentialRecord | null> {
    const row = await this.db.prepare(`
      SELECT credential.*
      FROM meta_whatsapp_credentials credential
      JOIN meta_whatsapp_connections connection
        ON connection.id = credential.connection_id
      JOIN integrations integration
        ON integration.id = credential.integration_id
      WHERE credential.tenant_id = ?
        AND credential.integration_id = ?
        AND credential.connection_id = ?
        AND credential.provider = 'meta_whatsapp'
        AND connection.tenant_id = credential.tenant_id
        AND connection.integration_id = credential.integration_id
        AND integration.tenant_id = credential.tenant_id
        AND integration.provider = credential.provider
      LIMIT 1
    `).bind(owner.tenantId, owner.integrationId, owner.connectionId).first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  }

  async replace(input: ReplacedMetaWhatsAppCredential): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE meta_whatsapp_credentials
      SET ciphertext = ?, nonce = ?, algorithm = ?, key_version = ?, metadata = ?,
          credential_version = credential_version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND integration_id = ?
        AND connection_id = ?
        AND provider = 'meta_whatsapp'
        AND status = 'active'
        AND credential_version = ?
        AND EXISTS (
          SELECT 1
          FROM meta_whatsapp_connections c
          JOIN integrations i ON i.id = c.integration_id
          WHERE c.id = meta_whatsapp_credentials.connection_id
            AND c.tenant_id = meta_whatsapp_credentials.tenant_id
            AND c.integration_id = meta_whatsapp_credentials.integration_id
            AND i.tenant_id = meta_whatsapp_credentials.tenant_id
            AND i.provider = meta_whatsapp_credentials.provider
        )
    `).bind(
      input.ciphertext,
      input.nonce,
      input.algorithm,
      input.keyVersion,
      input.metadata,
      input.tenantId,
      input.integrationId,
      input.connectionId,
      input.expectedVersion,
    ).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async setStatus(
    owner: MetaWhatsAppCredentialOwner,
    expectedVersion: number,
    status: Exclude<MetaWhatsAppCredentialStatus, "active">,
  ): Promise<boolean> {
    const revoking = status === "revoked";
    const result = await this.db.prepare(`
      UPDATE meta_whatsapp_credentials
      SET status = ?,
          ciphertext = CASE WHEN ? THEN NULL ELSE ciphertext END,
          nonce = CASE WHEN ? THEN NULL ELSE nonce END,
          revoked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE revoked_at END,
          credential_version = credential_version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND integration_id = ?
        AND connection_id = ?
        AND provider = 'meta_whatsapp'
        AND (
          status = 'active'
          OR (? = 'revoked' AND status = 'disabled')
        )
        AND credential_version = ?
    `).bind(
      status,
      revoking ? 1 : 0,
      revoking ? 1 : 0,
      revoking ? 1 : 0,
      owner.tenantId,
      owner.integrationId,
      owner.connectionId,
      status,
      expectedVersion,
    ).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async enable(owner: MetaWhatsAppCredentialOwner, expectedVersion: number): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE meta_whatsapp_credentials
      SET status = 'active', credential_version = credential_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND integration_id = ? AND connection_id = ? AND provider = 'meta_whatsapp'
        AND status = 'disabled' AND credential_version = ?
    `).bind(owner.tenantId, owner.integrationId, owner.connectionId, expectedVersion).run();
    return (result.meta?.changes ?? 0) === 1;
  }
}

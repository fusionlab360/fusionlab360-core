import { BaseRepository } from "../../../../persistence/repositories/base-repository";
import type { MetaWhatsAppConnectionRecord } from "./connection-model";

function mapRow(row: Record<string, unknown>): MetaWhatsAppConnectionRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    integrationId: String(row.integration_id),
    wabaId: String(row.waba_id),
    phoneNumberId: String(row.phone_number_id),
    status: row.status as MetaWhatsAppConnectionRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class MetaWhatsAppConnectionRepository extends BaseRepository {
  async findActiveByPhoneNumberId(phoneNumberId: string): Promise<MetaWhatsAppConnectionRecord | null> {
    const row = await this.db.prepare(`
      SELECT connection.*
      FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
      WHERE connection.phone_number_id = ?
        AND connection.status = 'active'
        AND integration.tenant_id = connection.tenant_id
        AND integration.provider = 'meta_whatsapp'
      LIMIT 2
    `).bind(phoneNumberId.trim()).all<Record<string, unknown>>();
    if ((row.results?.length ?? 0) > 1) throw new Error("Meta phone-number ownership is ambiguous.");
    return row.results?.[0] ? mapRow(row.results[0]) : null;
  }

  async findByTenantAndId(tenantId: string, id: string): Promise<MetaWhatsAppConnectionRecord | null> {
    const row = await this.db.prepare(`
      SELECT connection.*
      FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
      WHERE connection.tenant_id = ?
        AND connection.id = ?
        AND integration.tenant_id = connection.tenant_id
        AND integration.provider = 'meta_whatsapp'
      LIMIT 1
    `).bind(tenantId, id).first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  }

  async findByTenantIntegrationAndPhoneNumberId(tenantId: string, integrationId: string, phoneNumberId: string): Promise<MetaWhatsAppConnectionRecord | null> {
    const row = await this.db.prepare(`
      SELECT connection.* FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
      WHERE connection.tenant_id = ? AND connection.integration_id = ? AND connection.phone_number_id = ?
        AND integration.tenant_id = connection.tenant_id AND integration.provider = 'meta_whatsapp'
      LIMIT 1
    `).bind(tenantId, integrationId, phoneNumberId.trim()).first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  }

  async createPending(input: Pick<MetaWhatsAppConnectionRecord, "id" | "tenantId" | "integrationId" | "wabaId" | "phoneNumberId">): Promise<boolean> {
    const result = await this.db.prepare(`
      INSERT INTO meta_whatsapp_connections
        (id, tenant_id, integration_id, waba_id, phone_number_id, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
      ON CONFLICT(phone_number_id) DO NOTHING
    `).bind(input.id, input.tenantId, input.integrationId, input.wabaId, input.phoneNumberId).run();
    return result.meta.changes === 1;
  }

  async setStatus(tenantId: string, id: string, expected: MetaWhatsAppConnectionRecord["status"], status: MetaWhatsAppConnectionRecord["status"]): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE meta_whatsapp_connections SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND id = ? AND status = ?
        AND EXISTS (
          SELECT 1
          FROM integrations i
          WHERE i.id = meta_whatsapp_connections.integration_id
            AND i.tenant_id = meta_whatsapp_connections.tenant_id
            AND i.provider = 'meta_whatsapp'
        )
    `).bind(status, tenantId, id, expected).run();
    return result.meta.changes === 1;
  }
}

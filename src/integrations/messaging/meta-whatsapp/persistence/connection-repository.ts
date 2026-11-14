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
  async bindLegacyConnection(input: {
    tenantId: string; connectionId: string; locationId: string; providerId: string;
    actorId: string; evidenceReference: string; justification: string;
  }): Promise<boolean> {
    return this.bindConnection(input, { kind: "legacy" });
  }

  async bindDeveloperTestLegacyConnection(input: {
    tenantId: string; connectionId: string; locationId: string; providerId: string;
    actorId: string; evidenceReference: string; justification: string;
    wabaId: string; phoneNumberId: string;
  }): Promise<boolean> {
    return this.bindConnection(input, {
      kind: "developer_test", wabaId: input.wabaId, phoneNumberId: input.phoneNumberId,
    });
  }

  async findDeveloperTestBindingTarget(tenantId: string, connectionId: string): Promise<{
    integrationId: string; wabaId: string; phoneNumberId: string; developerTest: boolean;
  } | null> {
    const row = await this.db.prepare(`
      SELECT connection.integration_id AS integrationId,
        connection.waba_id AS wabaId,
        connection.phone_number_id AS phoneNumberId,
        CASE WHEN json_valid(meta_credential.metadata)
          THEN json_type(meta_credential.metadata, '$.developerTest') = 'true'
          ELSE 0 END AS developerTest
      FROM meta_whatsapp_connections connection
      JOIN integrations meta ON meta.id = connection.integration_id
        AND meta.tenant_id = connection.tenant_id AND meta.provider = 'meta_whatsapp'
      JOIN meta_whatsapp_credentials meta_credential
        ON meta_credential.connection_id = connection.id
        AND meta_credential.tenant_id = connection.tenant_id
        AND meta_credential.integration_id = connection.integration_id
        AND meta_credential.provider = 'meta_whatsapp'
      WHERE connection.tenant_id = ? AND connection.id = ?
      LIMIT 1
    `).bind(tenantId, connectionId).first<{
      integrationId: string; wabaId: string; phoneNumberId: string; developerTest: number;
    }>();
    return row ? {
      integrationId: row.integrationId,
      wabaId: row.wabaId,
      phoneNumberId: row.phoneNumberId,
      developerTest: row.developerTest === 1,
    } : null;
  }

  private async bindConnection(
    input: {
      tenantId: string; connectionId: string; locationId: string; providerId: string;
      actorId: string; evidenceReference: string; justification: string;
    },
    mode: { kind: "legacy" } | { kind: "developer_test"; wabaId: string; phoneNumberId: string },
  ): Promise<boolean> {
    const operationId = crypto.randomUUID();
    const reason = JSON.stringify({
      evidenceReference: input.evidenceReference,
      justification: input.justification,
      ghlProviderId: input.providerId,
      ...(mode.kind === "developer_test" ? {
        bindingType: "developer_test",
        wabaId: mode.wabaId,
        phoneNumberId: mode.phoneNumberId,
      } : {}),
    });
    const auditState = mode.kind === "developer_test"
      ? "developer_test_binding_established"
      : "legacy_binding_established";
    const evidenceType = mode.kind;
    const expectedWabaId = mode.kind === "developer_test" ? mode.wabaId : null;
    const expectedPhoneNumberId = mode.kind === "developer_test" ? mode.phoneNumberId : null;

    // D1 executes the batch sequentially in one transaction. The audit insert
    // claims the eligible row and the update is scoped to that exact claim.
    const [audit, update] = await this.db.batch([
      this.db.prepare(`
        WITH binding(tenant_id, connection_id, location_id, provider_id,
          evidence_ref, actor_id, reason, operation_id, evidence_type,
          expected_waba_id, expected_phone_number_id, audit_state)
          AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?))
        INSERT INTO meta_whatsapp_connection_activation_audit
          (tenant_id, connection_id, ghl_location_id, actor_client_id, previous_state, new_state, reason, trace_id)
        SELECT b.tenant_id, b.connection_id, b.location_id, b.actor_id,
          'legacy_active', b.audit_state, b.reason, b.operation_id
        FROM binding b
        JOIN meta_whatsapp_connections c ON c.id = b.connection_id AND c.tenant_id = b.tenant_id
        JOIN integrations meta ON meta.id = c.integration_id AND meta.tenant_id = c.tenant_id
          AND meta.provider = 'meta_whatsapp'
        WHERE c.status = 'active' AND c.activation_state = 'legacy_active'
          AND c.ghl_location_id IS NULL AND c.ghl_provider_id IS NULL
          AND (
            (b.evidence_type = 'developer_test'
              AND c.waba_id = b.expected_waba_id
              AND c.phone_number_id = b.expected_phone_number_id
              AND EXISTS (
                SELECT 1 FROM meta_whatsapp_credentials meta_credential
                WHERE meta_credential.tenant_id = b.tenant_id
                  AND meta_credential.integration_id = c.integration_id
                  AND meta_credential.connection_id = c.id
                  AND meta_credential.provider = 'meta_whatsapp'
                  AND CASE WHEN json_valid(meta_credential.metadata)
                    THEN json_type(meta_credential.metadata, '$.developerTest') = 'true'
                    ELSE 0 END
              ))
            OR (b.evidence_type = 'legacy'
              AND NOT EXISTS (
                SELECT 1 FROM meta_whatsapp_credentials meta_credential
                WHERE meta_credential.tenant_id = b.tenant_id
                  AND meta_credential.integration_id = c.integration_id
                  AND meta_credential.connection_id = c.id
                  AND meta_credential.provider = 'meta_whatsapp'
                  AND CASE WHEN json_valid(meta_credential.metadata)
                    THEN json_type(meta_credential.metadata, '$.developerTest') = 'true'
                    ELSE 0 END
              ))
          )
          AND (
            SELECT COUNT(*) FROM integrations ghl
            JOIN integration_credentials credential ON credential.tenant_id = ghl.tenant_id
              AND credential.provider = ghl.provider
            WHERE ghl.tenant_id = b.tenant_id AND ghl.provider = 'gohighlevel' AND ghl.enabled = 1
              AND credential.auth_type = 'oauth2' AND credential.location_id = b.location_id
              AND TRIM(credential.api_key) <> ''
              AND CASE WHEN json_valid(credential.metadata) THEN
                json_extract(credential.metadata, '$.connectionStatus') = 'connected'
                AND json_extract(credential.metadata, '$.companyId') IS NOT NULL END
              AND CASE WHEN json_valid(ghl.settings) THEN
                json_type(ghl.settings, '$.providerConfiguration.conversationProviderId') = 'text'
                AND TRIM(json_extract(ghl.settings, '$.providerConfiguration.conversationProviderId')) = b.provider_id END
          ) = 1
          AND NOT EXISTS (
            SELECT 1 FROM meta_whatsapp_legacy_approval_reviews review
            WHERE (review.tenant_id = b.tenant_id AND review.connection_id = b.connection_id)
              OR (review.tenant_id <> b.tenant_id AND review.evidence_ref = b.evidence_ref)
          )
          AND NOT EXISTS (
            SELECT 1 FROM meta_whatsapp_connection_activation_audit prior
            WHERE prior.tenant_id <> b.tenant_id
              AND prior.new_state IN ('legacy_binding_established', 'legacy_review_approved',
                'legacy_review_rejected', 'legacy_review_conflict',
                'developer_test_binding_established', 'active')
              AND CASE WHEN json_valid(prior.reason) THEN
                json_extract(prior.reason, '$.evidenceReference') = b.evidence_ref END
          )
      `).bind(input.tenantId, input.connectionId, input.locationId, input.providerId,
        input.evidenceReference, input.actorId, reason, operationId, evidenceType,
        expectedWabaId, expectedPhoneNumberId, auditState),
      this.db.prepare(`
        UPDATE meta_whatsapp_connections
        SET ghl_location_id = ?, ghl_provider_id = ?, activation_trace_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ? AND status = 'active' AND activation_state = 'legacy_active'
          AND ghl_location_id IS NULL AND ghl_provider_id IS NULL
          AND EXISTS (
            SELECT 1 FROM meta_whatsapp_connection_activation_audit audit
            WHERE audit.tenant_id = meta_whatsapp_connections.tenant_id
              AND audit.connection_id = meta_whatsapp_connections.id
              AND audit.new_state = ? AND audit.trace_id = ?
          )
      `).bind(input.locationId, input.providerId, operationId, input.tenantId, input.connectionId, auditState, operationId),
    ]);
    return audit?.meta.changes === 1 && update?.meta.changes === 1;
  }

  async findUniqueStatusByTenant(tenantId: string): Promise<{
    id: string;
    integrationId: string;
    status: MetaWhatsAppConnectionRecord["status"];
  } | null> {
    const rows = await this.db.prepare(`
      SELECT connection.id, connection.integration_id, connection.status
      FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
      WHERE connection.tenant_id = ?
        AND integration.tenant_id = connection.tenant_id
        AND integration.provider = 'meta_whatsapp'
      LIMIT 2
    `).bind(tenantId).all<{ id: string; integration_id: string; status: string }>();
    if ((rows.results?.length ?? 0) > 1) throw new Error("Meta WhatsApp connection ownership is ambiguous.");
    const row = rows.results?.[0];
    if (!row) return null;
    const allowedStatuses: readonly string[] = ["pending", "active", "disabled", "reauthorization_required"];
    return {
      id: row.id,
      integrationId: row.integration_id,
      status: allowedStatuses.includes(row.status) ? row.status as MetaWhatsAppConnectionRecord["status"] : "disabled",
    };
  }

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

  async findActiveByTenantAndGHLBinding(tenantId: string, locationId: string, providerId: string): Promise<MetaWhatsAppConnectionRecord | null> {
    const row = await this.db.prepare(`
      SELECT connection.* FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
        AND integration.tenant_id = connection.tenant_id AND integration.provider = 'meta_whatsapp'
      WHERE connection.tenant_id = ? AND connection.ghl_location_id = ?
        AND connection.ghl_provider_id = ? AND connection.status = 'active'
        AND connection.activation_state IN ('pending', 'active', 'legacy_active')
      LIMIT 2
    `).bind(tenantId, locationId.trim(), providerId.trim()).all<Record<string, unknown>>();
    if ((row.results?.length ?? 0) > 1) throw new Error("Meta GHL binding is ambiguous.");
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

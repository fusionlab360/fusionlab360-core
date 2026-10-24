import { BaseRepository } from "./base-repository";

export interface MessagingConversationSummary {
  id: string;
  provider: string;
  channel: string;
  connectionId: string;
  externalParticipantId: string;
  externalConversationId: string | null;
  channelProviderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessagingMessageSummary {
  id: string;
  conversationId: string;
  provider: string;
  channel: string;
  externalMessageId: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
  contentType: "text" | "unsupported";
  text: string | null;
  deliveryStatus: string | null;
  providerMessageId: string | null;
}

export interface MessagingPage<T> {
  items: T[];
  nextCursor: string | null;
}

export class MessagingCursorError extends Error {
  constructor() {
    super("The messaging cursor is invalid.");
    this.name = "MessagingCursorError";
  }
}

type ConversationCursor = { updatedAt: string; id: string };
type MessageCursor = { occurredAt: string; id: string };

function encodeCursor(value: ConversationCursor | MessageCursor): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor<T extends ConversationCursor | MessageCursor>(value: string | undefined, timestampField: "updatedAt" | "occurredAt"): T | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(normalized)) as Record<string, unknown>;
    if (typeof parsed.id !== "string" || !parsed.id.trim()) throw new Error();
    if (typeof parsed[timestampField] !== "string" || !String(parsed[timestampField]).trim()) throw new Error();
    return parsed as T;
  } catch {
    throw new MessagingCursorError();
  }
}

function mapConversation(row: Record<string, unknown>): MessagingConversationSummary {
  const provider = String(row.provider);
  return {
    id: String(row.id),
    provider,
    channel: typeof row.channel === "string" && row.channel.trim() && row.channel !== "unknown" ? row.channel : provider,
    connectionId: String(row.connection_id),
    externalParticipantId: String(row.external_participant_id),
    externalConversationId: typeof row.external_conversation_id === "string" ? row.external_conversation_id : null,
    channelProviderId: typeof row.channel_provider_id === "string" ? row.channel_provider_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): MessagingMessageSummary {
  const provider = String(row.provider);
  const direction = row.direction === "outbound" ? "outbound" : "inbound";
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    provider,
    channel: typeof row.channel === "string" && row.channel.trim() && row.channel !== "unknown" ? row.channel : provider,
    externalMessageId: String(row.external_message_id),
    direction,
    occurredAt: String(row.occurred_at),
    contentType: row.content_type === "unsupported" ? "unsupported" : "text",
    text: typeof row.text_content === "string" ? row.text_content : null,
    deliveryStatus: typeof row.delivery_status === "string" ? row.delivery_status : null,
    providerMessageId: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
  };
}

export class MessagingConversationRepository extends BaseRepository {
  async listForTenant(tenantId: string, options: { limit: number; cursor?: string }): Promise<MessagingPage<MessagingConversationSummary>> {
    const cursor = decodeCursor<ConversationCursor>(options.cursor, "updatedAt");
    const bindings: unknown[] = [tenantId];
    let predicate = "";
    if (cursor) {
      predicate = "AND (updated_at < ? OR (updated_at = ? AND id < ?))";
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    bindings.push(options.limit + 1);
    const result = await this.db.prepare(`
      SELECT id, provider, connection_id, external_participant_id,
             external_conversation_id, channel, channel_provider_id,
             created_at, updated_at
      FROM messaging_conversations
      WHERE tenant_id = ? ${predicate}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).bind(...bindings).all<Record<string, unknown>>();
    const rows = result.results ?? [];
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapConversation),
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: String(last.updated_at), id: String(last.id) }) : null,
    };
  }

  async findForTenant(tenantId: string, conversationId: string): Promise<MessagingConversationSummary | null> {
    const row = await this.db.prepare(`
      SELECT id, provider, connection_id, external_participant_id,
             external_conversation_id, channel, channel_provider_id,
             created_at, updated_at
      FROM messaging_conversations
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, conversationId).first<Record<string, unknown>>();
    return row ? mapConversation(row) : null;
  }

  async listMessagesForTenant(tenantId: string, conversationId: string, options: { limit: number; cursor?: string }): Promise<MessagingPage<MessagingMessageSummary>> {
    const cursor = decodeCursor<MessageCursor>(options.cursor, "occurredAt");
    const bindings: unknown[] = [tenantId, conversationId];
    let predicate = "";
    if (cursor) {
      predicate = "AND (m.occurred_at > ? OR (m.occurred_at = ? AND m.id > ?))";
      bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    bindings.push(options.limit + 1);
    const result = await this.db.prepare(`
      SELECT m.id, m.conversation_id, m.provider, m.external_message_id,
             m.direction, m.occurred_at, m.content_type, m.text_content,
             m.channel, m.channel_provider_id,
             linked.provider_message_id,
             COALESCE(
               linked.provider_delivery_status,
               linked.status,
               (SELECT d.provider_delivery_status
                FROM messaging_outbound_deliveries d
                WHERE d.tenant_id = m.tenant_id
                  AND d.provider = m.provider
                  AND d.conversation_id = m.conversation_id
                  AND d.provider_message_id = m.external_message_id
                ORDER BY d.updated_at DESC
                LIMIT 1),
               (SELECT d.status
                FROM messaging_outbound_deliveries d
                WHERE d.tenant_id = m.tenant_id
                  AND d.provider = m.provider
                  AND d.conversation_id = m.conversation_id
                  AND d.provider_message_id = m.external_message_id
                ORDER BY d.updated_at DESC
                LIMIT 1)
             ) AS delivery_status
      FROM messaging_messages m
      LEFT JOIN messaging_outbound_deliveries linked
        ON linked.id = m.outbound_delivery_id
       AND linked.tenant_id = m.tenant_id
       AND linked.provider = m.provider
      WHERE m.tenant_id = ? AND m.conversation_id = ? ${predicate}
      ORDER BY m.occurred_at ASC, m.id ASC
      LIMIT ?
    `).bind(...bindings).all<Record<string, unknown>>();
    const rows = result.results ?? [];
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapMessage),
      nextCursor: hasMore && last ? encodeCursor({ occurredAt: String(last.occurred_at), id: String(last.id) }) : null,
    };
  }

  async ensureOutbound(input: {
    tenantId: string;
    conversationId: string;
    deliveryId: string;
    text: string;
    occurredAt?: string;
  }): Promise<MessagingMessageSummary> {
    const delivery = await this.db.prepare(`
      SELECT id, provider, conversation_id, provider_message_id
      FROM messaging_outbound_deliveries
      WHERE id = ? AND tenant_id = ? AND provider = 'meta_whatsapp'
        AND conversation_id = ?
      LIMIT 1
    `).bind(input.deliveryId, input.tenantId, input.conversationId).first<{
      id: string;
      provider: string;
      conversation_id: string;
      provider_message_id: string | null;
    }>();
    if (!delivery) throw new Error("Outbound delivery is not authorized for this conversation.");

    const conversation = await this.findForTenant(input.tenantId, input.conversationId);
    if (!conversation || conversation.provider !== "meta_whatsapp") {
      throw new Error("Meta conversation is not available for this tenant.");
    }

    const messageId = crypto.randomUUID();
    await this.db.prepare(`
      INSERT OR IGNORE INTO messaging_messages (
        id, tenant_id, conversation_id, provider, external_message_id,
        direction, occurred_at, content_type, text_content, channel,
        channel_provider_id, outbound_delivery_id
      ) VALUES (?, ?, ?, 'meta_whatsapp', ?, 'outbound', ?, 'text', ?, 'whatsapp', ?, ?)
    `).bind(
      messageId,
      input.tenantId,
      input.conversationId,
      delivery.provider_message_id ?? `outbound:${delivery.id}`,
      input.occurredAt ?? new Date().toISOString(),
      input.text,
      conversation.channelProviderId,
      delivery.id,
    ).run();

    const row = await this.db.prepare(`
      SELECT m.id, m.conversation_id, m.provider, m.external_message_id,
             m.direction, m.occurred_at, m.content_type, m.text_content,
             m.channel, m.channel_provider_id,
             d.provider_message_id,
             COALESCE(d.provider_delivery_status, d.status) AS delivery_status
      FROM messaging_messages m
      LEFT JOIN messaging_outbound_deliveries d
        ON d.id = m.outbound_delivery_id
       AND d.tenant_id = m.tenant_id
      WHERE m.tenant_id = ? AND m.conversation_id = ?
        AND m.outbound_delivery_id = ?
      LIMIT 1
    `).bind(input.tenantId, input.conversationId, delivery.id).first<Record<string, unknown>>();
    if (!row) throw new Error("Outbound message could not be persisted.");
    return mapMessage(row);
  }

  async findOutboundByEffectKey(tenantId: string, conversationId: string, effectKey: string): Promise<MessagingMessageSummary | null> {
    const row = await this.db.prepare(`
      SELECT m.id, m.conversation_id, m.provider, m.external_message_id,
             m.direction, m.occurred_at, m.content_type, m.text_content,
             m.channel, m.channel_provider_id,
             d.provider_message_id,
             COALESCE(d.provider_delivery_status, d.status) AS delivery_status
      FROM messaging_messages m
      JOIN messaging_outbound_deliveries d
        ON d.id = m.outbound_delivery_id
       AND d.tenant_id = m.tenant_id
       AND d.provider = m.provider
      WHERE m.tenant_id = ? AND m.conversation_id = ?
        AND d.effect_key = ?
      LIMIT 1
    `).bind(tenantId, conversationId, effectKey).first<Record<string, unknown>>();
    return row ? mapMessage(row) : null;
  }

  private async upsertInboundForConnection(input: {
    tenantId: string;
    provider: string;
    connectionId: string;
    participantId: string;
    conversationId?: string;
    channel: string;
    channelProviderId?: string;
    externalMessageId: string;
    occurredAt: string;
    text: string;
  }): Promise<void> {
    const connection = await this.db.prepare(`
      SELECT id FROM messaging_connections
      WHERE id = ? AND tenant_id = ? AND provider = ? AND status = 'active'
      LIMIT 1
    `).bind(input.connectionId, input.tenantId, input.provider).first<{ id: string }>();
    if (!connection) throw new Error("Messaging connection is not active for this tenant.");

    const conversationId = crypto.randomUUID();
    await this.db.prepare(`
      INSERT INTO messaging_conversations (
        id, tenant_id, provider, connection_id, external_participant_id,
        external_conversation_id, channel, channel_provider_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).bind(
      conversationId,
      input.tenantId,
      input.provider,
      input.connectionId,
      input.participantId,
      input.conversationId ?? null,
      input.channel,
      input.channelProviderId ?? null,
    ).run();
    const row = input.conversationId
      ? await this.db.prepare(`
          SELECT id, external_participant_id FROM messaging_conversations
          WHERE tenant_id = ? AND provider = ? AND connection_id = ?
            AND external_conversation_id = ? LIMIT 1
        `).bind(input.tenantId, input.provider, input.connectionId, input.conversationId).first<{ id: string; external_participant_id: string }>()
      : await this.db.prepare(`
          SELECT id, external_participant_id FROM messaging_conversations
          WHERE tenant_id = ? AND provider = ? AND connection_id = ?
            AND external_participant_id = ? AND external_conversation_id IS NULL LIMIT 1
        `).bind(input.tenantId, input.provider, input.connectionId, input.participantId).first<{ id: string; external_participant_id: string }>();
    if (!row) throw new Error("Messaging conversation could not be resolved.");
    if (input.conversationId && row.external_participant_id !== input.participantId) {
      throw new Error("Messaging conversation participant ownership is inconsistent.");
    }

    await this.db.prepare(`
      UPDATE messaging_conversations
      SET updated_at = CURRENT_TIMESTAMP, channel = ?, channel_provider_id = ?
      WHERE tenant_id = ? AND id = ?
    `).bind(input.channel, input.channelProviderId ?? null, input.tenantId, row.id).run();
    await this.db.prepare(`
      INSERT INTO messaging_messages (
        id, tenant_id, conversation_id, provider, external_message_id,
        direction, occurred_at, content_type, text_content, channel, channel_provider_id
      ) VALUES (?, ?, ?, ?, ?, 'inbound', ?, 'text', ?, ?, ?)
      ON CONFLICT(tenant_id, provider, external_message_id) DO NOTHING
    `).bind(
      crypto.randomUUID(), input.tenantId, row.id, input.provider,
      input.externalMessageId, input.occurredAt, input.text,
      input.channel, input.channelProviderId ?? null,
    ).run();
  }

  async upsertInbound(input: {
    tenantId: string;
    connectionId: string;
    participantId: string;
    externalMessageId: string;
    occurredAt: string;
    text: string;
    channel?: string;
    channelProviderId?: string;
    conversationId?: string;
  }): Promise<void> {
    const connection = await this.db.prepare(`
      SELECT c.id, c.integration_id, c.phone_number_id, c.status
      FROM meta_whatsapp_connections c
      JOIN integrations i ON i.id = c.integration_id
      WHERE c.id = ? AND c.tenant_id = ? AND i.tenant_id = c.tenant_id
        AND i.provider = 'meta_whatsapp'
      LIMIT 1
    `).bind(input.connectionId, input.tenantId).first<{
      id: string; integration_id: string; phone_number_id: string; status: string;
    }>();
    if (!connection || connection.status !== "active") {
      throw new Error("Meta WhatsApp connection is not active for this tenant.");
    }
    await this.db.prepare(`
      INSERT INTO messaging_connections
        (id, tenant_id, provider, integration_id, external_id, status)
      VALUES (?, ?, 'meta_whatsapp', ?, ?, 'active')
      ON CONFLICT(tenant_id, provider, external_id) DO UPDATE SET
        status = excluded.status, updated_at = CURRENT_TIMESTAMP
    `).bind(connection.id, input.tenantId, connection.integration_id, connection.phone_number_id).run();
    await this.upsertInboundForConnection({
      ...input,
      provider: "meta_whatsapp",
      channel: input.channel ?? "whatsapp",
    });
  }

  async upsertGHLInbound(input: {
    tenantId: string;
    locationId: string;
    contactId: string;
    conversationId: string;
    messageId: string;
    occurredAt: string;
    text: string;
    channel: string;
    channelProviderId?: string;
    /** Persistence-only processing may use an ownership mapping without a token. */
    authorization?: "standard" | "persistence_only";
  }): Promise<void> {
    const locationId = input.locationId.trim();
    const integration = await this.db.prepare(`
      SELECT i.id AS integration_id
      FROM integrations i
      JOIN integration_credentials c
        ON c.tenant_id = i.tenant_id AND c.provider = i.provider
      WHERE i.tenant_id = ? AND i.provider = 'gohighlevel' AND i.enabled = 1
        AND TRIM(c.location_id) = ?
        AND (
          ? = 'persistence_only'
          OR (c.api_key IS NOT NULL AND TRIM(c.api_key) <> '')
        )
      LIMIT 2
    `).bind(
      input.tenantId,
      locationId,
      input.authorization ?? "standard",
    ).all<{ integration_id: string }>();
    if ((integration.results?.length ?? 0) !== 1) {
      throw new Error("GoHighLevel location is not active for this tenant.");
    }
    const connectionId = `gohighlevel:${integration.results![0]!.integration_id}:${locationId}`;
    await this.db.prepare(`
      INSERT INTO messaging_connections
        (id, tenant_id, provider, integration_id, external_id, status)
      VALUES (?, ?, 'gohighlevel', ?, ?, 'active')
      ON CONFLICT(tenant_id, provider, external_id) DO UPDATE SET
        integration_id = excluded.integration_id,
        status = 'active', updated_at = CURRENT_TIMESTAMP
    `).bind(connectionId, input.tenantId, integration.results![0]!.integration_id, locationId).run();
    await this.upsertInboundForConnection({
      tenantId: input.tenantId,
      provider: "gohighlevel",
      connectionId,
      participantId: input.contactId,
      conversationId: input.conversationId,
      channel: input.channel,
      channelProviderId: input.channelProviderId,
      externalMessageId: input.messageId,
      occurredAt: input.occurredAt,
      text: input.text,
    });
  }
}

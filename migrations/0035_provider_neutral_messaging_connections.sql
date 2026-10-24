-- M3B.2: make canonical messaging connections provider-neutral.
-- Existing 0031 tables were introduced for Meta WhatsApp only.  Rebuild the
-- two dependent tables so GHL conversations can use the same canonical store
-- without pretending that a GHL location is a Meta connection.
PRAGMA foreign_keys = OFF;

CREATE TABLE messaging_connections (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, provider, external_id)
);
CREATE INDEX idx_messaging_connections_tenant
  ON messaging_connections (tenant_id, provider, status);

INSERT INTO messaging_connections (
  id, tenant_id, provider, integration_id, external_id, status, created_at, updated_at
)
SELECT id, tenant_id, 'meta_whatsapp', integration_id, phone_number_id,
       status, created_at, updated_at
FROM meta_whatsapp_connections;

CREATE TABLE messaging_conversations_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_participant_id TEXT NOT NULL,
  external_conversation_id TEXT,
  channel TEXT NOT NULL DEFAULT 'unknown',
  channel_provider_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES messaging_connections(id) ON DELETE CASCADE
);

INSERT INTO messaging_conversations_v2 (
  id, tenant_id, provider, connection_id, external_participant_id,
  channel, created_at, updated_at
)
SELECT id, tenant_id, provider, connection_id, external_participant_id,
       provider, created_at, updated_at
FROM messaging_conversations;

CREATE TABLE messaging_messages_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  occurred_at TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','unsupported')),
  text_content TEXT,
  channel TEXT NOT NULL DEFAULT 'unknown',
  channel_provider_id TEXT,
  outbound_delivery_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES messaging_conversations_v2(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, provider, external_message_id),
  CHECK ((content_type = 'text' AND text_content IS NOT NULL) OR
         (content_type = 'unsupported' AND text_content IS NULL))
);

INSERT INTO messaging_messages_v2 (
  id, tenant_id, conversation_id, provider, external_message_id,
  direction, occurred_at, content_type, text_content, outbound_delivery_id,
  channel
)
SELECT id, tenant_id, conversation_id, provider, external_message_id,
       direction, occurred_at, content_type, text_content, outbound_delivery_id,
       provider
FROM messaging_messages;

DROP TABLE messaging_messages;
DROP TABLE messaging_conversations;
ALTER TABLE messaging_conversations_v2 RENAME TO messaging_conversations;
ALTER TABLE messaging_messages_v2 RENAME TO messaging_messages;

CREATE UNIQUE INDEX idx_messaging_conversations_meta_participant
  ON messaging_conversations (tenant_id, provider, connection_id, external_participant_id)
  WHERE external_conversation_id IS NULL;
CREATE UNIQUE INDEX idx_messaging_conversations_external
  ON messaging_conversations (tenant_id, provider, connection_id, external_conversation_id)
  WHERE external_conversation_id IS NOT NULL;
CREATE INDEX idx_messaging_conversations_tenant
  ON messaging_conversations(tenant_id, provider, updated_at);
CREATE INDEX idx_messaging_messages_conversation
  ON messaging_messages(tenant_id, conversation_id, occurred_at);
CREATE UNIQUE INDEX idx_messaging_messages_outbound_delivery
  ON messaging_messages (tenant_id, provider, outbound_delivery_id)
  WHERE outbound_delivery_id IS NOT NULL;

PRAGMA foreign_keys = ON;

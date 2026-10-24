CREATE TABLE messaging_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_participant_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES meta_whatsapp_connections(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, provider, connection_id, external_participant_id)
);
CREATE TABLE messaging_messages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  occurred_at TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','unsupported')),
  text_content TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, provider, external_message_id),
  CHECK ((content_type = 'text' AND text_content IS NOT NULL) OR (content_type = 'unsupported' AND text_content IS NULL))
);
CREATE INDEX idx_messaging_conversations_tenant ON messaging_conversations(tenant_id, provider, updated_at);
CREATE INDEX idx_messaging_messages_conversation ON messaging_messages(tenant_id, conversation_id, occurred_at);

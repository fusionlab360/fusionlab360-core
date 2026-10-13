ALTER TABLE integration_events ADD COLUMN external_event_id TEXT;
ALTER TABLE integration_events ADD COLUMN idempotency_key TEXT;
ALTER TABLE integration_events ADD COLUMN processing_lease_token TEXT;
ALTER TABLE integration_events ADD COLUMN processing_lease_expires_at TEXT;

CREATE UNIQUE INDEX idx_integration_events_idempotency_key
ON integration_events (idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE messaging_outbound_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'unknown')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  provider_conversation_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, event_id, effect_key)
);

CREATE INDEX idx_messaging_outbound_deliveries_recovery
ON messaging_outbound_deliveries (tenant_id, status, updated_at);

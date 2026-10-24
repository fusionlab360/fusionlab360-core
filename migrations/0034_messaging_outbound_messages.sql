ALTER TABLE messaging_messages ADD COLUMN outbound_delivery_id TEXT;

CREATE UNIQUE INDEX idx_messaging_messages_outbound_delivery
ON messaging_messages (tenant_id, provider, outbound_delivery_id)
WHERE outbound_delivery_id IS NOT NULL;

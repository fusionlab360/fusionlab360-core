ALTER TABLE messaging_outbound_deliveries ADD COLUMN connection_id TEXT;
ALTER TABLE messaging_outbound_deliveries ADD COLUMN recipient_id TEXT;
CREATE INDEX idx_messaging_outbound_meta_provider_message ON messaging_outbound_deliveries (tenant_id, provider, provider_message_id);

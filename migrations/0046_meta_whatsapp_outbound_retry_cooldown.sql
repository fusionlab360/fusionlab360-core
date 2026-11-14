-- Persist provider-directed throttling windows without changing existing deliveries.
ALTER TABLE messaging_outbound_deliveries ADD COLUMN retry_after_at TEXT;

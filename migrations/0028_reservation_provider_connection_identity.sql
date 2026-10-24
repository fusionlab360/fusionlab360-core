-- Add provider connection and property boundaries for channel-manager
-- synchronization. Existing rows remain valid with NULL scope columns.
ALTER TABLE reservation_records
ADD COLUMN provider_connection_id TEXT;

ALTER TABLE reservation_records
ADD COLUMN provider_property_id TEXT
CHECK (
  (provider_connection_id IS NULL AND provider_property_id IS NULL)
  OR (
    provider_connection_id IS NOT NULL
    AND length(trim(provider_connection_id)) > 0
    AND provider_property_id IS NOT NULL
    AND length(trim(provider_property_id)) > 0
  )
);

CREATE UNIQUE INDEX idx_reservation_records_provider_scope
ON reservation_records (
  tenant_id,
  provider,
  provider_connection_id,
  provider_property_id,
  provider_reservation_id
)
WHERE provider_connection_id IS NOT NULL
  AND provider_property_id IS NOT NULL;

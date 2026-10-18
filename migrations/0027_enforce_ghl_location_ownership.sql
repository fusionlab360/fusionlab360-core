-- Prerequisite for concurrent tenant provisioning: one owner per GHL Location.
-- Includes inactive tenants, pending OAuth records and legacy PIT credentials.
-- Review normalized duplicates before application; do not delete/reassign rows:
-- SELECT COUNT(*) AS owners FROM integration_credentials
-- WHERE provider = 'gohighlevel' AND location_id IS NOT NULL
--   AND TRIM(location_id) <> ''
-- GROUP BY TRIM(location_id) HAVING COUNT(*) > 1;
-- Existing duplicates cause index creation to fail without changing credentials.
CREATE UNIQUE INDEX idx_credentials_ghl_location_owner
ON integration_credentials (TRIM(location_id))
WHERE provider = 'gohighlevel'
  AND location_id IS NOT NULL
  AND TRIM(location_id) <> '';

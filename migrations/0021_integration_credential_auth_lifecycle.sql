-- ==========================================================
-- 0021_integration_credential_auth_lifecycle.sql
-- Generic credential authentication mode + OAuth lifecycle
-- ==========================================================

ALTER TABLE integration_credentials
ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key'
CHECK (auth_type IN ('api_key', 'oauth2'));

ALTER TABLE integration_credentials
ADD COLUMN access_token_expires_at INTEGER;

ALTER TABLE integration_credentials
ADD COLUMN refresh_lock_token TEXT;

ALTER TABLE integration_credentials
ADD COLUMN refresh_lock_expires_at INTEGER;

ALTER TABLE oauth_installations
ADD COLUMN access_token_expires_at INTEGER;

ALTER TABLE oauth_installations
ADD COLUMN refresh_lock_token TEXT;

ALTER TABLE oauth_installations
ADD COLUMN refresh_lock_expires_at INTEGER;

-- ----------------------------------------------------------
-- Backfill existing GHL Location OAuth credentials
-- ----------------------------------------------------------

UPDATE integration_credentials
SET
    auth_type = 'oauth2',
    access_token_expires_at =
      (
        CAST(strftime('%s', updated_at) AS INTEGER) * 1000
      )
      +
      (
        COALESCE(
          CAST(
            json_extract(metadata, '$.expiresIn')
            AS INTEGER
          ),
          86400
        ) * 1000
      )
WHERE provider = 'gohighlevel'
  AND refresh_token IS NOT NULL
  AND trim(refresh_token) <> ''
  AND json_valid(metadata) = 1
  AND json_extract(metadata, '$.accountType') = 'location';

-- ----------------------------------------------------------
-- Backfill existing GHL Company OAuth installation
-- ----------------------------------------------------------

UPDATE oauth_installations
SET
    access_token_expires_at =
      (
        CAST(strftime('%s', updated_at) AS INTEGER) * 1000
      )
      +
      (
        COALESCE(
          CAST(
            json_extract(metadata, '$.expiresIn')
            AS INTEGER
          ),
          86400
        ) * 1000
      )
WHERE provider = 'gohighlevel'
  AND account_type = 'company'
  AND refresh_token IS NOT NULL
  AND trim(refresh_token) <> '';
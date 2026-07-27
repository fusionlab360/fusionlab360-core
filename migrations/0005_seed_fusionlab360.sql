-- ==========================================================
-- 0005_seed_fusionlab360.sql
-- Seed data for FusionLab360
-- ==========================================================

-- ----------------------------------------------------------
-- Tenant
-- ----------------------------------------------------------

INSERT INTO tenants (
    id,
    name
)
VALUES (
    'fusionlab360',
    'FusionLab360'
);

-- ----------------------------------------------------------
-- API Client
-- ----------------------------------------------------------

INSERT INTO clients (
    id,
    tenant_id,
    name,
    api_key_hash,
    permissions
)
VALUES (
    'browser-extension',
    'fusionlab360',
    'FusionLab360 Browser Extension',

    -- Replace with the SHA-256 hash of your FusionLab360 API key
    'REPLACE_WITH_API_KEY_HASH',

    '["contacts:create","contacts:update","contacts:delete"]'
);

-- ----------------------------------------------------------
-- Integration
-- ----------------------------------------------------------

INSERT INTO integrations (
    id,
    tenant_id,
    provider,
    enabled,
    settings
)
VALUES (
    'ghl-main',
    'fusionlab360',
    'gohighlevel',
    1,
    '{}'
);

-- ----------------------------------------------------------
-- Integration Credentials
-- ----------------------------------------------------------

INSERT INTO integration_credentials (
    tenant_id,
    provider,
    api_key,
    location_id,
    refresh_token,
    metadata
)
VALUES (
    'fusionlab360',
    'gohighlevel',
    'ghl_api_key',
    'location_id',
    NULL,
    NULL
);
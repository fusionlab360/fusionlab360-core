-- ==========================================================
-- 0004_create_integration_credentials.sql
-- Credentials for tenant integrations
-- ==========================================================

CREATE TABLE integration_credentials (

    -- Composite Identity
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    -- Provider Credentials
    api_key TEXT,

    location_id TEXT,

    refresh_token TEXT,

    metadata TEXT,

    -- Audit
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Relationships
    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    PRIMARY KEY (
        tenant_id,
        provider
    )
);

-- ==========================================================
-- Indexes
-- ==========================================================

CREATE INDEX idx_credentials_tenant
ON integration_credentials (tenant_id);

CREATE INDEX idx_credentials_provider
ON integration_credentials (provider);
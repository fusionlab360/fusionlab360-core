-- ==========================================================
-- 0003_create_integrations.sql
-- Integration definitions for each tenant
-- ==========================================================

CREATE TABLE integrations (

    -- Primary Key
    id TEXT PRIMARY KEY,

    -- Tenant Relationship
    tenant_id TEXT NOT NULL,

    -- Integration Provider
    provider TEXT NOT NULL,

    -- Enable / Disable Integration
    enabled INTEGER NOT NULL DEFAULT 1,

    -- Provider Configuration (JSON)
    settings TEXT,

    -- Audit
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Relationships
    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE
);

-- ==========================================================
-- Indexes
-- ==========================================================

CREATE INDEX idx_integrations_tenant
ON integrations (tenant_id);

CREATE INDEX idx_integrations_provider
ON integrations (provider);

CREATE UNIQUE INDEX idx_integrations_tenant_provider
ON integrations (
    tenant_id,
    provider
);
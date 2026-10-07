-- ==========================================================
-- 0017_create_knowledge_sources.sql
-- Canonical knowledge source containers
-- ==========================================================

CREATE TABLE knowledge_sources (

    -- Internal identity
    id TEXT NOT NULL,

    -- Tenant / provider identity
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    -- Provider-side Knowledge Base identity
    provider_source_id TEXT NOT NULL,

    -- Canonical source information
    name TEXT NOT NULL,

    description TEXT,

    -- Complete provider metadata / raw representation
    metadata TEXT,

    raw_payload TEXT,

    -- Source lifecycle
    source_created_at TEXT,

    source_updated_at TEXT,

    synced_at TEXT,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (
            status IN (
                'active',
                'deleted'
            )
        ),

    -- Audit
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Relationships
    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    PRIMARY KEY (
        id
    ),

    UNIQUE (
        tenant_id,
        provider,
        provider_source_id
    )
);

-- ==========================================================
-- Indexes
-- ==========================================================

CREATE INDEX idx_knowledge_sources_tenant
ON knowledge_sources (
    tenant_id
);

CREATE INDEX idx_knowledge_sources_provider
ON knowledge_sources (
    provider
);

CREATE INDEX idx_knowledge_sources_tenant_provider
ON knowledge_sources (
    tenant_id,
    provider
);
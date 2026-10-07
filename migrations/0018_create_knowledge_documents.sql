-- ==========================================================
-- 0018_create_knowledge_documents.sql
-- Canonical knowledge documents / items
-- ==========================================================

CREATE TABLE knowledge_documents (

    -- Internal identity
    id TEXT NOT NULL,

    -- Tenant / provider identity
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    -- Parent canonical knowledge source
    knowledge_source_id TEXT NOT NULL,

    -- Provider-side document identity
    provider_document_id TEXT NOT NULL,

    -- Canonical source classification
    source_type TEXT NOT NULL,

    -- Content
    title TEXT,

    content TEXT,

    source_url TEXT,

    mime_type TEXT,

    -- Complete provider metadata / raw representation
    metadata TEXT,

    raw_payload TEXT,

    -- Change detection
    content_hash TEXT,

    -- Provider lifecycle timestamps
    source_created_at TEXT,

    source_updated_at TEXT,

    source_deleted_at TEXT,

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

    FOREIGN KEY (knowledge_source_id)
        REFERENCES knowledge_sources(id)
        ON DELETE CASCADE,

    PRIMARY KEY (
        id
    ),

    UNIQUE (
        tenant_id,
        provider,
        source_type,
        provider_document_id
    )
);

-- ==========================================================
-- Indexes
-- ==========================================================

CREATE INDEX idx_knowledge_documents_tenant
ON knowledge_documents (
    tenant_id
);

CREATE INDEX idx_knowledge_documents_source
ON knowledge_documents (
    knowledge_source_id
);

CREATE INDEX idx_knowledge_documents_provider
ON knowledge_documents (
    provider
);

CREATE INDEX idx_knowledge_documents_type
ON knowledge_documents (
    source_type
);

CREATE INDEX idx_knowledge_documents_hash
ON knowledge_documents (
    content_hash
);

CREATE INDEX idx_knowledge_documents_updated
ON knowledge_documents (
    source_updated_at
);
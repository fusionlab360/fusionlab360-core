CREATE TABLE oauth_authorization_states (
    state_hash TEXT PRIMARY KEY NOT NULL,

    tenant_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    provider TEXT NOT NULL,

    purpose TEXT NOT NULL DEFAULT 'connect',
    context_json TEXT NOT NULL DEFAULT '{}',

    -- Unix epoch timestamps in milliseconds.
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    FOREIGN KEY (integration_id)
        REFERENCES integrations(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_oauth_authorization_states_expiry
    ON oauth_authorization_states(expires_at, consumed_at);

CREATE INDEX idx_oauth_authorization_states_tenant_provider
    ON oauth_authorization_states(tenant_id, provider);
CREATE TABLE clients (
    id TEXT PRIMARY KEY,

    tenant_id TEXT NOT NULL,

    name TEXT NOT NULL,

    api_key_hash TEXT NOT NULL UNIQUE,

    status TEXT NOT NULL DEFAULT 'active',

    permissions TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_clients_tenant
ON clients (tenant_id);

CREATE UNIQUE INDEX idx_clients_api_key_hash
ON clients (api_key_hash);
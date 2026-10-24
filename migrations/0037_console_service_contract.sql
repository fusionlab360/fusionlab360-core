CREATE TABLE IF NOT EXISTS console_service_idempotency (
  client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, idempotency_key),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS client_tenant_grants (
  client_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  grant_scope TEXT NOT NULL CHECK(grant_scope IN ('tenants:read','messaging:read')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(client_id, tenant_id, grant_scope),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_tenant_grants_tenant ON client_tenant_grants(tenant_id, grant_scope);

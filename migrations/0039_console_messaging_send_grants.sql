-- Add the explicit manual-reply grant without rewriting the historical 0037 migration.
PRAGMA foreign_keys = OFF;

CREATE TABLE client_tenant_grants_v2 (
  client_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  grant_scope TEXT NOT NULL CHECK(grant_scope IN ('tenants:read','contacts:read','messaging:read','messaging:send')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(client_id, tenant_id, grant_scope),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

INSERT INTO client_tenant_grants_v2 (client_id, tenant_id, grant_scope, created_at)
SELECT client_id, tenant_id, grant_scope, created_at
FROM client_tenant_grants;

DROP TABLE client_tenant_grants;
ALTER TABLE client_tenant_grants_v2 RENAME TO client_tenant_grants;
CREATE INDEX idx_client_tenant_grants_tenant ON client_tenant_grants(tenant_id, grant_scope);

PRAGMA foreign_keys = ON;

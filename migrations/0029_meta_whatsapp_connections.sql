CREATE TABLE meta_whatsapp_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'disabled', 'reauthorization_required')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  UNIQUE (phone_number_id),
  UNIQUE (tenant_id, waba_id, phone_number_id)
);

CREATE INDEX idx_meta_whatsapp_connections_tenant
  ON meta_whatsapp_connections (tenant_id, status);

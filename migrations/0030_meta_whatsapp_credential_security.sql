-- Meta WhatsApp credentials are separate from legacy integration_credentials.
-- This avoids changing or implicitly migrating existing provider credentials.

-- An integration_id foreign key alone cannot prove tenant consistency because
-- integrations.id is globally unique. Keep the existing connection table
-- tenant-scoped even if a row is written outside the HTTP route.
CREATE TRIGGER trg_meta_whatsapp_connection_tenant_insert
BEFORE INSERT ON meta_whatsapp_connections
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM integrations i
  WHERE i.id = NEW.integration_id
    AND i.tenant_id = NEW.tenant_id
    AND i.provider = 'meta_whatsapp'
)
BEGIN
  SELECT RAISE(ABORT, 'Meta WhatsApp connection integration ownership mismatch');
END;

CREATE TRIGGER trg_meta_whatsapp_connection_tenant_update
BEFORE UPDATE OF tenant_id, integration_id ON meta_whatsapp_connections
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM integrations i
  WHERE i.id = NEW.integration_id
    AND i.tenant_id = NEW.tenant_id
    AND i.provider = 'meta_whatsapp'
)
BEGIN
  SELECT RAISE(ABORT, 'Meta WhatsApp connection integration ownership mismatch');
END;

CREATE TABLE meta_whatsapp_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'meta_whatsapp'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'disabled', 'revoked')
  ),
  ciphertext TEXT,
  nonce TEXT,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-GCM'),
  key_version TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES meta_whatsapp_connections(id) ON DELETE CASCADE,
  UNIQUE (connection_id),
  CHECK (
    status = 'revoked'
    OR (
      ciphertext IS NOT NULL
      AND length(trim(ciphertext)) > 0
      AND nonce IS NOT NULL
      AND length(trim(nonce)) > 0
    )
  )
);

CREATE INDEX idx_meta_whatsapp_credentials_tenant_connection
  ON meta_whatsapp_credentials (tenant_id, integration_id, connection_id);

-- Enforce the same tenant and integration at the credential boundary as well.
CREATE TRIGGER trg_meta_whatsapp_credential_owner_insert
BEFORE INSERT ON meta_whatsapp_credentials
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM meta_whatsapp_connections c
  JOIN integrations i ON i.id = c.integration_id
  WHERE c.id = NEW.connection_id
    AND c.tenant_id = NEW.tenant_id
    AND c.integration_id = NEW.integration_id
    AND i.tenant_id = NEW.tenant_id
    AND i.provider = NEW.provider
)
BEGIN
  SELECT RAISE(ABORT, 'Meta WhatsApp credential ownership mismatch');
END;

CREATE TRIGGER trg_meta_whatsapp_credential_owner_update
BEFORE UPDATE OF tenant_id, integration_id, connection_id, provider
ON meta_whatsapp_credentials
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM meta_whatsapp_connections c
  JOIN integrations i ON i.id = c.integration_id
  WHERE c.id = NEW.connection_id
    AND c.tenant_id = NEW.tenant_id
    AND c.integration_id = NEW.integration_id
    AND i.tenant_id = NEW.tenant_id
    AND i.provider = NEW.provider
)
BEGIN
  SELECT RAISE(ABORT, 'Meta WhatsApp credential ownership mismatch');
END;

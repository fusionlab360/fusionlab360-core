-- Tenant approval is separate from Meta authorization/credential status.
-- Preserve pre-migration active connections until an explicit lifecycle transition.
ALTER TABLE meta_whatsapp_connections ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (activation_state IN ('pending', 'legacy_active', 'active', 'suspended', 'revoked'));
ALTER TABLE meta_whatsapp_connections ADD COLUMN ghl_location_id TEXT;
ALTER TABLE meta_whatsapp_connections ADD COLUMN ghl_provider_id TEXT;
ALTER TABLE meta_whatsapp_connections ADD COLUMN activation_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_whatsapp_connections ADD COLUMN activation_actor TEXT;
ALTER TABLE meta_whatsapp_connections ADD COLUMN activation_reason TEXT;
ALTER TABLE meta_whatsapp_connections ADD COLUMN activation_trace_id TEXT;

UPDATE meta_whatsapp_connections SET activation_state = 'legacy_active'
WHERE status = 'active' AND EXISTS (
  SELECT 1 FROM integrations i WHERE i.id = meta_whatsapp_connections.integration_id
    AND i.tenant_id = meta_whatsapp_connections.tenant_id AND i.provider = 'meta_whatsapp'
);


CREATE UNIQUE INDEX idx_meta_whatsapp_active_ghl_binding
  ON meta_whatsapp_connections (ghl_location_id, ghl_provider_id)
  WHERE activation_state IN ('active', 'legacy_active');

CREATE TABLE meta_whatsapp_connection_activation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  ghl_location_id TEXT,
  actor_client_id TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  trace_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (connection_id) REFERENCES meta_whatsapp_connections(id)
);

CREATE TRIGGER trg_meta_whatsapp_activation_transition
BEFORE UPDATE OF activation_state ON meta_whatsapp_connections
FOR EACH ROW WHEN NEW.activation_state <> OLD.activation_state
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.activation_state = 'pending' AND NEW.activation_state = 'active') OR
    (OLD.activation_state = 'legacy_active' AND NEW.activation_state IN ('active', 'suspended', 'revoked')) OR
    (OLD.activation_state = 'active' AND NEW.activation_state IN ('suspended', 'revoked')) OR
    (OLD.activation_state = 'suspended' AND NEW.activation_state IN ('active', 'revoked')) OR
    (OLD.activation_state = 'revoked' AND NEW.activation_state = 'pending'
      AND NEW.activation_reason = 'verified_onboarding')
  ) THEN RAISE(ABORT, 'Invalid Meta activation transition') END;
  SELECT CASE WHEN NEW.activation_actor IS NULL OR trim(NEW.activation_actor) = ''
    OR NEW.activation_reason IS NULL OR trim(NEW.activation_reason) = ''
    THEN RAISE(ABORT, 'Meta activation actor and reason required') END;
  SELECT CASE WHEN NEW.activation_state = 'active' AND (
    NEW.status <> 'active' OR NEW.ghl_location_id IS NULL OR trim(NEW.ghl_location_id) = ''
    OR NEW.ghl_provider_id IS NULL OR trim(NEW.ghl_provider_id) = ''
  ) THEN RAISE(ABORT, 'Meta activation prerequisites missing') END;
  SELECT CASE WHEN NEW.activation_state = 'active' AND NOT EXISTS (
    SELECT 1 FROM integration_credentials credential
    WHERE credential.tenant_id = NEW.tenant_id AND credential.provider = 'gohighlevel'
      AND credential.auth_type = 'oauth2' AND credential.location_id = NEW.ghl_location_id
  ) THEN RAISE(ABORT, 'Meta activation GHL location ownership mismatch') END;
END;

CREATE TRIGGER trg_meta_whatsapp_activation_audit
AFTER UPDATE OF activation_state ON meta_whatsapp_connections
FOR EACH ROW WHEN NEW.activation_state <> OLD.activation_state
BEGIN
  INSERT INTO meta_whatsapp_connection_activation_audit
    (tenant_id, connection_id, ghl_location_id, actor_client_id, previous_state, new_state, reason, trace_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.ghl_location_id, NEW.activation_actor,
    OLD.activation_state, NEW.activation_state, NEW.activation_reason, NEW.activation_trace_id);
END;

CREATE TRIGGER trg_meta_whatsapp_activation_insert
BEFORE INSERT ON meta_whatsapp_connections
FOR EACH ROW WHEN NEW.activation_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'New Meta activation must be pending');
END;

CREATE TRIGGER trg_meta_whatsapp_active_binding_immutable
BEFORE UPDATE OF tenant_id, integration_id, phone_number_id, ghl_location_id, ghl_provider_id
ON meta_whatsapp_connections
FOR EACH ROW WHEN OLD.activation_state IN ('active', 'legacy_active')
  AND NEW.activation_state = OLD.activation_state AND (
  NEW.tenant_id <> OLD.tenant_id OR NEW.integration_id <> OLD.integration_id OR
  NEW.phone_number_id <> OLD.phone_number_id OR
  NEW.ghl_location_id <> OLD.ghl_location_id OR NEW.ghl_provider_id <> OLD.ghl_provider_id
)
BEGIN
  SELECT RAISE(ABORT, 'Active Meta binding is immutable');
END;

CREATE TRIGGER trg_meta_whatsapp_activation_audit_immutable_update
BEFORE UPDATE ON meta_whatsapp_connection_activation_audit
BEGIN
  SELECT RAISE(ABORT, 'Meta activation audit is append-only');
END;

CREATE TRIGGER trg_meta_whatsapp_activation_audit_immutable_delete
BEFORE DELETE ON meta_whatsapp_connection_activation_audit
BEGIN
  SELECT RAISE(ABORT, 'Meta activation audit is append-only');
END;

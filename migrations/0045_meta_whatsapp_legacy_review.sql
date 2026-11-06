-- Forward-only bridge for databases that already applied the original 0042.
-- No connection is approved by this migration. Reviewed records are added
-- separately after an operator verifies historical eligibility.
-- Fail before any DDL if the 0042 lifecycle and audit prerequisites are absent.
-- SQLite defers validation of trigger-body column references until trigger use,
-- so the explicit zero-row reads are required to prevent partial pre-0042 setup.
SELECT activation_state, ghl_location_id, ghl_provider_id
FROM meta_whatsapp_connections LIMIT 0;
SELECT id, tenant_id, connection_id, actor_client_id, new_state, reason
FROM meta_whatsapp_connection_activation_audit LIMIT 0;
SELECT tenant_id, provider, auth_type, location_id
FROM integration_credentials LIMIT 0;

CREATE TABLE IF NOT EXISTS meta_whatsapp_legacy_approval_reviews (
  connection_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ghl_location_id TEXT NOT NULL,
  ghl_provider_id TEXT NOT NULL,
  reviewer_client_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES meta_whatsapp_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CHECK (TRIM(ghl_location_id) <> '' AND TRIM(ghl_provider_id) <> ''),
  CHECK (TRIM(reviewer_client_id) <> '' AND TRIM(evidence_ref) <> '')
);

CREATE TRIGGER IF NOT EXISTS trg_meta_legacy_review_eligibility
BEFORE INSERT ON meta_whatsapp_legacy_approval_reviews
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM meta_whatsapp_connections c
    JOIN integrations i ON i.id = c.integration_id
      AND i.tenant_id = c.tenant_id AND i.provider = 'meta_whatsapp'
    JOIN integration_credentials credential ON credential.tenant_id = c.tenant_id
      AND credential.provider = 'gohighlevel' AND credential.auth_type = 'oauth2'
      AND credential.location_id = NEW.ghl_location_id
    WHERE c.id = NEW.connection_id AND c.tenant_id = NEW.tenant_id
      AND c.status = 'active' AND c.activation_state IN ('pending', 'legacy_active')
  ) THEN RAISE(ABORT, 'Legacy approval ownership or eligibility mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_meta_legacy_review_immutable_update
BEFORE UPDATE ON meta_whatsapp_legacy_approval_reviews
BEGIN
  SELECT RAISE(ABORT, 'Legacy approval review is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_meta_legacy_review_immutable_delete
BEFORE DELETE ON meta_whatsapp_legacy_approval_reviews
BEGIN
  SELECT RAISE(ABORT, 'Legacy approval review is append-only');
END;

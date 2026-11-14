-- Replace the binding guard on both historical 0042 schemas without changing any rows.
SELECT activation_state, ghl_location_id, ghl_provider_id FROM meta_whatsapp_connections LIMIT 0;
SELECT trace_id, reason FROM meta_whatsapp_connection_activation_audit LIMIT 0;

DROP TRIGGER IF EXISTS trg_meta_whatsapp_active_binding_immutable;

CREATE TRIGGER trg_meta_whatsapp_active_binding_immutable
BEFORE UPDATE OF tenant_id, integration_id, phone_number_id, ghl_location_id, ghl_provider_id
ON meta_whatsapp_connections
FOR EACH ROW WHEN (
    OLD.activation_state IN ('active', 'legacy_active', 'suspended', 'revoked')
    OR OLD.ghl_location_id IS NOT NULL OR OLD.ghl_provider_id IS NOT NULL
    OR NEW.activation_state = 'active'
  ) AND (
    NEW.tenant_id IS NOT OLD.tenant_id OR NEW.integration_id IS NOT OLD.integration_id OR
    NEW.phone_number_id IS NOT OLD.phone_number_id OR (
      (NEW.ghl_location_id IS NOT OLD.ghl_location_id OR NEW.ghl_provider_id IS NOT OLD.ghl_provider_id)
      AND NOT (
        OLD.ghl_location_id IS NULL AND OLD.ghl_provider_id IS NULL
        AND NEW.ghl_location_id IS NOT NULL AND trim(NEW.ghl_location_id) <> ''
        AND NEW.ghl_provider_id IS NOT NULL AND trim(NEW.ghl_provider_id) <> ''
        AND (
          -- The 0042 transition trigger checks initial pending activation and location ownership.
          (OLD.activation_state = 'pending' AND NEW.activation_state = 'active')
          OR (
            OLD.activation_state = 'legacy_active' AND NEW.activation_state = 'legacy_active'
            AND OLD.status = 'active' AND NEW.status = 'active'
            AND EXISTS (
              SELECT 1 FROM meta_whatsapp_connection_activation_audit audit
              JOIN integrations meta ON meta.id = OLD.integration_id
                AND meta.tenant_id = OLD.tenant_id AND meta.provider = 'meta_whatsapp'
              JOIN integration_credentials credential ON credential.tenant_id = OLD.tenant_id
                AND credential.provider = 'gohighlevel' AND credential.auth_type = 'oauth2'
                AND credential.location_id = NEW.ghl_location_id
              WHERE audit.tenant_id = OLD.tenant_id AND audit.connection_id = OLD.id
                AND audit.previous_state = 'legacy_active'
                AND audit.new_state IN ('legacy_binding_established', 'developer_test_binding_established')
                AND audit.trace_id = NEW.activation_trace_id
                AND audit.ghl_location_id = NEW.ghl_location_id
                AND CASE WHEN json_valid(audit.reason)
                  THEN json_extract(audit.reason, '$.ghlProviderId') IS NEW.ghl_provider_id
                  ELSE 0 END
            )
          )
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Active Meta binding is immutable');
END;

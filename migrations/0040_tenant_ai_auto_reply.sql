-- Existing tenants without a recorded preference remain disabled. Explicit
-- ON/OFF rows are preserved by INSERT OR IGNORE. New tenants use the feature
-- definition default (disabled) until an authorized admin enables replies.
INSERT OR IGNORE INTO tenant_feature_settings (tenant_id, feature_key, enabled)
SELECT id, 'ai_auto_reply', 0
FROM tenants;

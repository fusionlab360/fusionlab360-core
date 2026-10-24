# Production Schema Diff

Date: 2026-10-24

## Applied versus source

Production `d1_migrations` contains `0001` through `0027`, including both `0023` migrations. The source directory contains 41 files. Pending source files are `0028` through `0041`.

## Objects present in production before upgrade

Present and used by current runtime:

- `tenants`, `clients`, `integrations`, `integration_credentials`
- `reservation_links`, `reservation_records`
- `integration_events`, `integration_event_dead_letters`
- `ai_conversation_sessions`, `ai_agent_profiles`, `ai_booking_sessions`
- `oauth_installations`, `oauth_authorization_states`
- `knowledge_sources`, `knowledge_documents`, FTS5 tables and triggers
- `tenant_feature_settings`
- `messaging_outbound_deliveries`

Additional objects present outside the current migration source include historical reservation/event backup tables and Cloudflare-managed objects. They are retained.

## Missing objects required by current source

- Reservation provider-scope columns/index from `0028`
- Meta connection/credential tables and ownership triggers from `0029`/`0030`
- Canonical messaging tables and indexes from `0031`–`0035`
- Console users/memberships from `0036`
- Console service idempotency/grants/identity from `0037`–`0038`
- Messaging-send and feature grant scopes from `0039`/`0041`

## Precondition results

- `reservation_records` contains 1,749 rows and lacks the `0028` provider scope columns.
- Normalized duplicate GHL Location groups: 0.
- `idx_credentials_ghl_location_owner`: present.
- Existing tenant/client/integration counts: 4 / 3 / 4.
- Existing `tenant_feature_settings`: 6 rows; no `ai_auto_reply` rows.
- Existing event and delivery data is non-empty and must be preserved.

## Risks

1. `0035` rebuilds messaging tables and contains an explicit transaction wrapper. Historical local D1 rehearsal evidence showed D1/workerd transaction-wrapper incompatibility; remote D1 compatibility remains unverified.
2. `0039` and `0041` rebuild `client_tenant_grants`; permission rows must be counted before and after.
3. `0040` would activate unknown AI state because it inserts `enabled=1`, contradicting the runtime's missing-row OFF default.
4. The old production Worker is currently serving while the entire new chain is pending. Application rollback after schema mutation has not been proven.
5. Full SQL export is unavailable because of FTS5 virtual tables; Time Travel bookmark recovery exists but restoration has not been tested.

# WABA 0042 and 0045 compatibility

Migrations are forward-only. Never rewrite or reapply 0042 on a database whose migration ledger records it. Migration 0045 begins with zero-row prerequisite reads for the 0042 lifecycle columns, activation audit table, and GHL credential ownership columns; it must fail before creating review objects if those prerequisites are missing.

## Forward-only sequence by database history

| Database history | Required sequence |
| --- | --- |
| Fresh database | Apply the normal migration sequence, including revised `0042_meta_whatsapp_connection_activation.sql`, followed by `0045_meta_whatsapp_legacy_review.sql`. |
| Existing pre-0042 database | Verify the ledger and base connection/integration/credential schema; apply revised 0042 once, then apply 0045. Keep lifecycle enforcement off throughout. |
| Original 0042 already applied | Preserve the ledger and original CHECK constraint. Apply only 0045. Do not rerun revised 0042 or rebuild the connection table. |
| Revised 0042 already applied | Apply only 0045. Do not rerun 0042. |

The original 0042 shape allows `pending`, `active`, `suspended`, and `revoked`; the revised shape also allows `legacy_active` and preserves eligible historical rows in that state. Both shapes can use the 0045 review marker. The local migration tests verify both histories and confirm 0045 fails before 0042 without leaving partial schema objects.

Apply 0046 for outbound retry storage, then 0047 on either 0042 history. 0047 replaces only the binding trigger. An unbound legacy connection can be bound once by the existing audited workflow, which must supply both verified values. Existing rows and historical 0042 checksums are preserved.

## Authorization and activation

Neither migration history, `status='active'`, lifecycle state, nor message activity proves prior operator approval. Revised 0042 may label an existing active row `legacy_active` as a compatibility state, but that label alone does not make the row eligible: lifecycle enforcement requires an explicit tenant-scoped review record with no later rejection/conflict audit. The original 0042 shape can use a reviewed pending row without changing its CHECK constraint. New connections remain pending; suspended and revoked connections are ineligible.

Migration 0045 creates an append-only, tenant-scoped review record and eligibility/immutability triggers; it grants no approvals. Before lifecycle enforcement can be enabled, an operator must independently verify pre-migration approval evidence for each connection, confirm the tenant's Meta integration and GHL OAuth location/provider ownership, and record the reviewer and evidence reference. Production connection review remains a separate explicit approval decision. Message activity is not approval evidence.

`WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED` defaults to `false`. With the gate off, the eligibility check attempts to read the 0042 state and falls back to existing active-status/tenant checks only when the lifecycle column is absent (the pre-0042 production shape). Once the 0042 column exists, `active` connections remain eligible and historical `legacy_active` connections retain gate-off compatibility, but `pending`, `suspended`, and `revoked` connections are denied. This prevents newly onboarded pending connections from dispatching while the approval gate remains off. With enforcement on, a status-active connection is eligible only when its lifecycle state is `active`, or its `pending`/`legacy_active` state has a matching review record with no later rejection/conflict audit. If a lifecycle/review query fails while enforcement is on, the connection is denied. This supports either 0042 shape without replaying a historical migration.

The local review API is registered under `/integrations/meta-whatsapp/connections/legacy-reviews`. Both GET and POST require `integrations:write` through `requireTenantClientPermission`; tenant and reviewer client identity come from the authenticated principal. POST accepts only tenant-qualified evidence references (`<tenant-id>:<reference>`) listed in the server-side `WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST`. Operators must establish that those exact references point to independently verified pre-migration approval records before configuring the allowlist. Arbitrary URLs or caller supplied identifiers are not accepted as proof. Decisions append to the existing activation audit table; the legacy approval table supplies the eligibility marker. Conflicting outcomes append a conflict audit record and make the legacy marker ineligible until separately reviewed. The API never transitions connection lifecycle state.

The review routes check for the 0042/0045 tables, columns, and append-only/eligibility triggers after authentication and `integrations:write` authorization. Missing schema returns HTTP 503 `SCHEMA_NOT_READY` without a write. Production rollout still requires evidence allowlist configuration, an independently verified eligible-connection inventory, and separate migration and activation approvals.

This local candidate has no automatic production migration or activation step. Remote 0042 history and real approval evidence still require read-only preflight and separate approval. The original 0042 schema does not permit the literal `legacy_active` value, so the reviewed record represents effective legacy eligibility without rewriting its existing table.

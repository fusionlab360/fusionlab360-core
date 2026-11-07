# WABA integration recovery milestone evidence

Candidate worktree: `waba-integration-recovery`
Base commit: `9381fb84b1e1886467b0ff78c386fbc702d41453`
Verification scope: local development only; no remote migrations, uploads, deployments, or live provider traffic.

## M2 — lifecycle and legacy review

**Locally implemented and verified.** Forward-only migration 0045 supports the earlier and revised 0042 database shapes without granting legacy eligibility automatically. Its initial zero-row prerequisite reads reject pre-0042 schemas before creating DDL. The authenticated tenant-scoped review GET/POST endpoints require `integrations:write`; they return HTTP 503 `SCHEMA_NOT_READY` when required tables, columns, or immutability/eligibility triggers are absent. Evidence references must match the tenant-qualified server-side `WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST`; decision history is append-only. `WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED` defaults off. With the gate off, pre-0042 active connections retain existing routing, migrated `legacy_active` connections remain eligible, and migrated `pending`, `suspended`, or `revoked` connections are denied. New onboarding on pre-0042 schemas is stopped before Meta calls unless it reauthorizes an already active connection.

Evidence: legacy review route and eligibility tests pass; the migration upgrade suite passes against both 0042 histories; lifecycle tests reject pending, suspended, revoked, cross-tenant, and conflicting review cases. Production eligibility still requires independently verified evidence and a separately approved migration/rollout.

## M3 — bidirectional messaging

**Locally implemented and verified with mock provider boundaries.** The two-tenant E2E suite exercises Meta webhook signature and phone mapping, durable event persistence, queue dispatch/consumption, inbound canonical persistence, signed GHL callback handling, tenant-bound connection and conversation selection, the Meta outbound dispatcher, duplicate handling, the 24-hour window, and receipt correlation. Tenant A/B use separate synthetic credentials, locations, providers, phone IDs, connections, conversations, and message IDs. External HTTP is blocked by the test fetch stub; the GHL publication/contact lookup and Meta transport are local mocks.

Evidence: `two-tenant-bidirectional.e2e.test.ts` passes. This is local mock evidence only; provider acceptance and delivery have not been re-verified live by this candidate.

## M4 — migration and lifecycle compatibility

**Locally implemented and verified.** Migration 0045 is forward-only and idempotent in tests. The lifecycle enforcement flag defaults off and leaves the existing inbound code path available when off. When on, unapproved pending connections and suspended/revoked connections are denied; an explicit approved review record allows the pending legacy-review path. Reviewed legacy eligibility remains a local policy until remote schema and evidence are separately verified.

Evidence: `0045_legacy_review_upgrade.py`, `waba_readonly_pre0042.py`, and lifecycle E2E cases pass. No remote migration was run.

## M5 — operations

**Locally implemented and verified for existing focused checks.** Tenant-scoped operational summary and alert evaluation code remains in the candidate; external alert delivery is disabled by default.

Evidence: relevant operational summary tests were part of prior candidate validation; production alert behavior is not activated or verified.

## Validation snapshot

- Focused Meta/GHL, review, lifecycle, queue, two-tenant E2E, and pre-0042 inbound webhook/Queue tests: 52/52 passed.
- Migration 0045 prerequisite and upgrade tests: 3/3 passed.
- Pre-0042 schema compatibility check: passed.
- Scoped TypeScript (`tsconfig.canary.json`): passed.
- Release-verifier fixtures: 9/9 passed.
- Wrangler `versions upload --dry-run --env='' --keep-vars`: passed; Wrangler printed a sandbox EPERM while attempting to write its local diagnostic log, then completed the dry run.
- `git diff --check`: passed.

**Not staged, deployed, or live verified.** Next release work requires reviewed remote schema provenance and legacy eligibility evidence, provider-side acceptance in an approved nonproduction environment, and separate production approvals.

## Controlled cleanup and source consolidation — 2026-11-07

**Local implementation and validation only.** A new isolated worktree, `fl360-clean-consolidation`, was created from the WABA candidate's base commit and overlaid with the candidate's manifest-listed source state. The original WABA and iPaaS remediation worktrees were preserved.

Ported the iPaaS request-path logging redaction, booking-intent error/output redactions, GHL adapter/client diagnostic redactions, their regression tests, and the protected `/auth/me` route/test. The `src/config/app.ts` logger hunk was manually merged while retaining the WABA preview security middleware and exact verifier CORS behavior. `/auth/me` now requires authentication and retains the existing `CurrentUser` response field shape; no other repository consumer was found.

Applied non-force, semver-compatible fixes to existing dependencies only. `package.json` and the dependency set are unchanged; the lockfile moves existing packages to patched releases. `npm audit` reported zero vulnerabilities after the update. `crypto-js` remains an existing deprecated dependency; it was not introduced by this consolidation.

Evidence: 106 Core test files / 769 tests passed; migration 0045 and pre-0042 compatibility tests passed; release-verifier fixtures 9/9 passed; full and scoped TypeScript passed. Wrangler dry-run passed with a local Wrangler log-write `EPERM` warning. No deployment, migration, secret write, message send, production setting change, or Marketplace operation occurred.

**State: LOCAL_ONLY.** The consolidated candidate is not the uploaded version `385e660c-6efc-4085-9ebe-8d7ac7e1fc7d`; that remote version remains a separate inactive artifact. Production's observed D1 ledger is pre-0042 and pre-0045. No lifecycle enforcement or other new gate was enabled. Developer-test onboarding remains a pre-existing enabled, narrowly allowlisted production capability and is a separate security-review item.

## Developer-managed multi-tenant readiness — 2026-11-07

**Implemented and locally verified; not staged, deployed, or live-verified.** Added a tenant-scoped developer control plane using the existing tenant-client authentication, permissions, Meta credential vault, GHL ownership records, and migration audit schema. The customer dashboard, identity verifier, lifecycle enforcement, Meta outbound, new queue-envelope rollout, and external alert delivery remain default-off.

- Added bounded `GET /integrations/meta-whatsapp/connections` inventory under `integrations:read`; it returns only tenant-owned connection and sanitized credential-health metadata.
- Added `POST /integrations/meta-whatsapp/connections/:connectionId/lifecycle` under `integrations:write`; it derives tenant/operator from authenticated context, checks lifecycle schema and ownership, requires an exact tenant-qualified evidence reference for activation, and audits activate/suspend/revoke. Revocation uses the existing credential repository to revoke stored material.
- Kept state-bound Meta onboarding. New migrated connections stay pending; pre-0042 onboarding that would create a new connection fails before a Meta call with `503 SCHEMA_NOT_READY`. Existing pre-0042 status-active reauthorization remains compatible.
- Corrected dispatch eligibility so lifecycle-off does not make migrated pending rows eligible: active is eligible, legacy-active preserves existing inbound while enforcement is off, pending requires enforcement plus an approved legacy review, and suspended/revoked are always denied. Pre-0042 active/status behavior remains compatible while enforcement is off.
- Limited the pre-0042 fallback to the known missing `activation_state` column. Other D1 lifecycle-query errors deny routing, and onboarding stops before Meta calls. Added explicit transient-database-failure regressions.
- Added the HTTPS-only `scripts/waba-connection.ps1` helper and `docs/WABA_DEVELOPER_CONTROL_PLANE.md`, including pilot, second-tenant, evidence, and rollback procedures. It does not edit D1 directly or expose the developer-test token route.
- The CLI requires typed confirmation of the exact HTTPS origin, disables redirects, prompts for the API key using `SecureString`, and requires additional confirmation for mutations/production.
- Expanded the release verifier to fail if activation or legacy evidence allowlists are non-empty in the gate-off baseline.

Validation on this source state:

- Full Core suite: 107 test files, 779/779 passing. Windows command-line limits required invoking `tsx --test` in groups of at most 10 test files.
- Focused Meta WhatsApp suite: 83/83 passing.
- TypeScript: `tsc --noEmit` passed.
- Migration compatibility: `python tests/migrations/waba_readonly_pre0042.py` passed; `python tests/migrations/0045_legacy_review_upgrade.py` passed (3/3).
- Release verifier: `pwsh -NoProfile -File scripts/waba-p04-release-verify.test.ps1` passed (14/14); the new operator helper parsed successfully with the PowerShell AST parser.
- Wrangler `deploy --dry-run --env=""` exited 0 and compiled the production-configured bundle. Wrangler emitted a local log-file `EPERM` warning from its user-profile log path; no upload or remote operation occurred.
- The consolidated manifest was regenerated and all 642 listed source hashes verified; manifest SHA-256 `0130eceaca24fd1e2356df63f67acd85568b30d7d92bfd1636276c8be1718382`.
- `git diff --check` passed; only line-ending conversion warnings were emitted.

Remaining gates are external and approval-controlled: independently establish the production D1's migration history and approved legacy evidence; review the pre-existing developer-test onboarding exposure; verify real GHL provider installation and Meta asset ownership in a permitted nonproduction setup; and obtain separate approval for any migration, secret/configuration change, upload, promotion, or live message test. Local mocks do not establish provider acceptance or production readiness.

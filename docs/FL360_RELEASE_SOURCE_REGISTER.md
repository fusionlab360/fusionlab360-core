# FL360 Release Source Register

Updated 2026-11-09. This register distinguishes live deployment state from uploaded and local-only candidates. The latest gap-closure work performed read-only production metadata/schema checks only; it did not change production.

## Source and deployment states

| Artifact | Identifier / path | State | Evidence and limitation |
|---|---|---|---|
| Production Worker | `fusionlab360-core`, version `b6d6c87d-1232-46b4-b33d-7cd0e3de0f49` | `DEPLOYED` | Read-only verification 2026-11-09: 100% traffic, deployment `cdb5cc7b-de96-4821-9bea-ce3dfdaabdf7`, created 2026-11-05 13:40:07 UTC. No production write occurred. |
| Integrated WABA candidate | version `385e660c-6efc-4085-9ebe-8d7ac7e1fc7d`, tag `fl360-waba-integrated-m2-m5-gates-off` | `UPLOADED_INACTIVE` | Version metadata showed it inactive. This version predates this cleanup's redaction and dependency-lock updates; it is not the consolidated source below. |
| Original WABA source | `.worktrees/waba-integration-recovery` | `LOCAL_ONLY` | Base commit `9381fb84b1e1886467b0ff78c386fbc702d41453`; original 634-entry manifest SHA-256 `6eb9d2f8ab43ea630f94b80bed5399f4df83e2b340dd971a3342ea992af40ee3`; all 634 entries still match. Preserved unchanged. |
| iPaaS remediation source | `.worktrees/ipaas-completion-remediation` | `LOCAL_ONLY` | Base commit `9381fb84b1e1886467b0ff78c386fbc702d41453`; 15-entry manifest SHA-256 `85f206a31c68ae0b55fd9e4fd1c63c1a032f934d4e7bf1e8c6b6579e927146e0`; all 15 entries still match. Preserved unchanged. |
| Consolidated development candidate | `.worktrees/fl360-clean-consolidation`, branch `integration/fl360-core-consolidated` | `LOCAL_ONLY` | Current gap-closure implementation is based on verified minimum HEAD `6c82d2eb75463099f8d485d2a5660d84192be112`; final local commit SHA is in the task result. The regenerated 650-entry source manifest SHA-256 is `72880d885328e6258f8e883e4b0e20b18fe353823c2103fd7f8ad99674ec5eae`. The manifest excludes administrative release/decision registers. No upload or deployment corresponds to this local source. |
| Security S1 reference source | `.worktrees/security-s1` and `.worktrees/waba-s1-p04-integration` | `LOCAL_ONLY` | Read-only reference worktrees remain unchanged. The selected GHL encryption, bounded webhook, error-sanitization, and CORS fixes are implemented in the consolidated candidate; no production key or migration was introduced. |
| P0-4 snapshot | D:\Important Fusion Migration\FL360_Release_Archive\waba-p04-m2-20261107\release-snapshots\waba-p04-m2-20261105 | ARCHIVED_LOCAL_SOURCE | 609-file archive; all ARCHIVE_SHA256SUMS.txt entries verified with zero mismatches (index SHA-256 8bfbcd248577bae3d66d1180f53a0100b512a094ed18bf13a9068cf14d9d453f). Provenance remains P0-1 base 9381fb84b1e1886467b0ff78c386fbc702d41453; this is not a deployed rollback version or the integrated candidate. |
| Production rollback target | version `b6d6c87d-1232-46b4-b33d-7cd0e3de0f49` | `DEPLOYED` | Current observed active safe version; use only with a separately approved rollback action if a later release is authorized. |

## Consolidated source contents

The candidate includes the 634-entry WABA source state plus:

- Request-path logging redaction in `src/config/app.ts`, manually merged with WABA preview security middleware and exact verifier CORS behavior.
- Booking-intent AI response/error log redaction.
- GoHighLevel adapter/client identifier, URL, and provider-error redactions.
- Authenticated `/auth/me` handling with the existing `CurrentUser` field shape.
- The nine remediation regression tests (four newly added test files and five updated test files).
- Tenant-scoped developer connection inventory, lifecycle controls, onboarding compatibility checks, the HTTPS-only developer CLI, its operator guide, and activation-evidence release-gate checks.
- Non-force, semver-compatible lockfile security updates. No dependency names were added or removed by the audit fix; the WABA candidate already declares `crypto-js` for encrypted GHL context validation. Relative to the WABA baseline, `package.json` is unchanged and the lockfile package-name set remains 102 entries with zero additions/removals.
- `CONSOLIDATED_CANDIDATE_MANIFEST.sha256` and its deterministic generator.

All WABA-specific new gates remain default-off in the candidate configuration: dashboard, context verifier, lifecycle enforcement, operator diagnostics, new queue envelopes, and external alert delivery. Meta outbound remains disabled. The production D1 has no 0042 or 0045 history, so no migration readiness or production release is implied by local tests.

## Production feature state last observed

- Inbound enabled for tenant `gmmetro`; outbound disabled.
- Dashboard disabled; diagnostic and queue-envelope rollout flags disabled.
- Pilot allowlists remain tenant `gmmetro`, location `Npx2IdDDRjXz2QW3Svx4`, user `0pBHBAOAqx8eINEAsTXH`, company `iv9tiC7pYHDfqrXo0ZO6`, app `6aae88f014820909a78cd923`.
- The pre-existing `META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED=true` setting remains a separate production security-review item, restricted by the observed single tenant/WABA/phone tuple. It was not changed or exercised.
- Lifecycle enforcement, activation evidence allowlist, legacy review evidence allowlist, dashboard, context verifier, Meta outbound, new queue-envelope rollout, and external alerts remain disabled/empty in the local configuration. Wrangler dry-run exited 0 and showed the six configured production bindings; it emitted a sandbox EPERM warning when attempting to write its user-profile log.

## Remaining release acceptance

1. Reverify production version/health/config immediately before any later release operation.
2. Resolve the remote pre-0042/pre-0045 schema plan and legacy eligibility evidence through a separately approved migration/review process; never infer approval from message activity.
3. Complete approved nonproduction provider acceptance and genuine GHL context testing. Local mocks do not establish live provider behavior.
4. Review the enabled developer-test onboarding surface and its authorized operator controls; do not disable it without separate approval.
5. Confirm external consumers tolerate `/auth/me` now requiring authentication; the response field shape is preserved, and no in-repository consumer was found.
6. Obtain separate approval before any Worker upload, traffic promotion, secret change, remote D1 migration, GHL configuration, or live messaging.

## Developer-managed readiness validation — 2026-11-07

Commit `afcab60b51566e40fd295e1bd43416ed34576be6` was validated locally on `integration/fl360-core-consolidated`; no push or remote action occurred. Full Core tests passed 779/779 across 107 files; the focused Meta WhatsApp suite passed 83/83; `tsc --noEmit`, pre-0042 compatibility, migration 0045 upgrade (3/3), release-verifier fixtures (14/14), PowerShell helper parsing, Wrangler `deploy --dry-run --env=""`, and `git diff --check` passed. The final 642-entry manifest was regenerated and every entry hash verified. No remote D1, Worker, secret, Marketplace, or messaging operation was performed.

This is local implementation evidence only. Production release still requires a separate review of actual remote migration history, independently supported legacy-connection evidence, developer-test onboarding exposure, verified GHL provider installation and Meta ownership, plus separate approval for deployment/migration/configuration/live testing.

Current release classification: consolidated candidate is `LOCAL_ONLY` and locally tested; not staged, not deployed, and not live-verified.

## Core production gap closure — 2026-11-09

Implemented locally on the canonical consolidated branch. GHL OAuth company/location credentials now use versioned AES-GCM envelopes with owner-bound associated data, strict key requirements for writes, controlled plaintext compatibility reads, and resumable compare-and-set migration batches. GHL inbound/provider-outbound requests now use bounded raw-byte reads. ApiError response/log disclosure is allowlisted. General CORS requires exact configured origins while preserving webhook and GHL verifier behavior.

Validation: full Core suite 805/805 passed across 111 test files; `npx tsc --noEmit` passed; regenerated 650-entry manifest verified with zero missing/hash mismatches. The current production D1 was confirmed pre-0042 from schema metadata; no 0042/0045/0046 ledger rows were present and `retry_after_at` was absent. Queue names and producer/consumer counts were observed; backlog depth was not available from Wrangler. The active Worker remains `b6d6c87d` at 100%. The inactive versions `385e660c` and `6d24ac5b` remain separate from this source.

See `FL360_CORE_PRODUCTION_GAP_CLOSURE.md` for the exact migration order, secret and CORS prerequisites, backup procedure, compatibility assessment, stop/rollback plan, and BLOCKED release decision. No secret values, credential rows, or Queue payloads were read. No production migration, Worker upload/deployment, secret/flag/traffic change, provider call, message send, Marketplace action, or WABA candidate modification occurred.

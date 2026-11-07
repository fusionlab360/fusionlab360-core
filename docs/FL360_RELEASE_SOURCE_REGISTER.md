# FL360 Release Source Register

Updated 2026-11-07. This register distinguishes live deployment state from uploaded and local-only candidates. No release or production action was performed by this cleanup task.

## Source and deployment states

| Artifact | Identifier / path | State | Evidence and limitation |
|---|---|---|---|
| Production Worker | `fusionlab360-core`, version `b6d6c87d-1232-46b4-b33d-7cd0e3de0f49` | `DEPLOYED` | Last read-only verification: 100% traffic, health HTTP 200, deployment `cdb5cc7b-de96-4821-9bea-ce3dfdaabdf7`. No production operation occurred during this cleanup. |
| Integrated WABA candidate | version `385e660c-6efc-4085-9ebe-8d7ac7e1fc7d`, tag `fl360-waba-integrated-m2-m5-gates-off` | `UPLOADED_INACTIVE` | Version metadata showed it inactive. This version predates this cleanup's redaction and dependency-lock updates; it is not the consolidated source below. |
| Original WABA source | `.worktrees/waba-integration-recovery` | `LOCAL_ONLY` | Base commit `9381fb84b1e1886467b0ff78c386fbc702d41453`; original 634-entry manifest SHA-256 `6eb9d2f8ab43ea630f94b80bed5399f4df83e2b340dd971a3342ea992af40ee3`; all 634 entries still match. Preserved unchanged. |
| iPaaS remediation source | `.worktrees/ipaas-completion-remediation` | `LOCAL_ONLY` | Base commit `9381fb84b1e1886467b0ff78c386fbc702d41453`; 15-entry manifest SHA-256 `85f206a31c68ae0b55fd9e4fd1c63c1a032f934d4e7bf1e8c6b6579e927146e0`; all 15 entries still match. Preserved unchanged. |
| Consolidated development candidate | `.worktrees/fl360-clean-consolidation`, branch `integration/fl360-core-consolidated` | `LOCAL_ONLY` | Latest implementation commit `afcab60b51566e40fd295e1bd43416ed34576be6` (`feat(waba): add developer-managed connection control plane`), based on prior consolidated source commit `763937b` and P0-1 base `9381fb84b1e1886467b0ff78c386fbc702d41453`. The verified 642-entry source manifest SHA-256 is `c33d08888d5dcb09775a7b1ebd3e22bb88f6c647aeca49c308bc4b3145be9fe2`; the manifest excludes the three administrative registers. The commit adds tenant-scoped connection inventory and lifecycle operations, safe pre-0042 compatibility, developer CLI/docs, evidence-gate verification, and regressions. |
| Security S1 source | `.worktrees/security-s1` and `.worktrees/waba-s1-p04-integration` | `LOCAL_ONLY` | Registered worktrees; Security S1 changes were not merged into this candidate. No keyring or S1 migration dependency was introduced. |
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

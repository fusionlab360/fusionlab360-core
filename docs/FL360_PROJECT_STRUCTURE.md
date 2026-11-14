# FusionLab360 Core Project Structure

Updated 2026-11-07 for the local WABA/iPaaS consolidation candidate.

## Canonical repository areas

| Path | Responsibility | Retention guidance |
|---|---|---|
| `src/bootstrap`, `src/config`, `src/core`, `src/middleware`, `src/tenants`, `src/clients` | Shared Worker bootstrap, bindings, authentication, authorization, and tenant infrastructure | Canonical Core runtime; preserve. |
| `src/domain` | Tenant-neutral business services such as authentication, booking, messaging, and Console service APIs | Keep domain behavior here; do not move provider request details into this layer. |
| `src/integrations` | Provider adapters, OAuth, webhook and transport boundaries, persistence repositories, and queue handling | Canonical provider-specific integration layer; preserve signatures, tenant ownership, and retry contracts. |
| `migrations` | Ordered D1 schema changes and compatibility history | Preserve every numbered migration; never rewrite an applied migration. |
| `tests` | Unit, route, integration, migration, and fixture coverage | Preserve historical fixtures; use synthetic data and mocked external providers. |
| `docs` | Architecture, runbooks, milestone evidence, release and cleanup registers | Distinguish verified implementation from plans and production evidence. |
| `scripts` | Local release verification, fixture tests, and reproducible manifest helpers | Review commands before execution; production-changing scripts require separate approval. |
| `release` and `release-snapshots` | Historical release records and source snapshots | Preserve; identify each as historical, active, or candidate. |
| `diagnostics` | Isolated probes and recovered deployment evidence | Retain pending review; do not bundle recovered production source or temporary probes into releases. |
| `.worktrees` | Independent local development/release worktrees | Preserve registrations and dirty work; do not reset, prune, or stage the directory wholesale. |
| `.wrangler`, `.local-m3b3`, `node_modules` | Local generated bundles, simulator state, caches, and installed dependencies | Local state may contain data; do not copy or archive blindly. Regenerate only where the specific artifact is known to be generated. |

## Worktree purposes observed

| Worktree | Purpose/state |
|---|---|
| `waba-integration-recovery` | Original local M2–M5 WABA candidate; preserved unchanged. |
| `ipaas-completion-remediation` | Local redaction/auth remediation source; preserved unchanged. |
| `fl360-clean-consolidation` | This new isolated consolidation candidate, based on commit `9381fb84b1e1886467b0ff78c386fbc702d41453`. |
| `waba-p04-release`, `waba-integrated-release`, `waba-readonly-canary`, `waba-readonly-management`, `waba-m2-identity-verifier`, `p02-ghl-page`, `security-s1`, `waba-s1-p04-integration`, `marketplace-verifier-release` | Existing registered worktrees; retain their independent state. They were not merged wholesale. |

## Boundaries

Core remains the iPaaS orchestration layer. GoHighLevel and Meta WhatsApp provider behavior remains under `src/integrations`; booking and messaging business logic remains under their domain boundaries. STAAH remains a synthetic mock adapter and does not establish live STAAH compatibility. The separate Console and Careflow applications are not embedded in this Core worktree. `tests/domain/console-service` is Core-owned API/service test coverage, not a copied Console frontend.

The `CONSOLIDATED_CANDIDATE_MANIFEST.sha256` covers the WABA candidate manifest inputs plus the new remediation tests and manifest generator. The three administrative registers created for this cleanup are intentionally excluded from that source/test manifest.

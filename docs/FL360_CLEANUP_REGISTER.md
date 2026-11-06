# FL360 Cleanup Register

Inspection date: 2026-11-07. Scope: the original Core checkout and the isolated consolidation worktree. No original WABA/iPaaS worktree or production resource was cleaned, reset, deleted, or archived. One separately registered, clean sibling worktree (`fusionlab360-core-c2e`) was removed normally after confirming its source commit is an ancestor of `main` and its only ignored files were regenerable `node_modules`.

## Root artifact inventory

| Original path | Classification / Git status | Purpose and sensitivity | Recommendation | Action |
|---|---|---|---|---|
| `.local-m3b3/` | Ignored local files; nine Miniflare SQLite/cache files | Simulator D1/cache state may contain local records; values were not read or copied. | `RETAIN_PENDING_REVIEW` | Preserved; not archived. |
| `.oauth-refresh-backup/` | Tracked; ten TypeScript files | Historical OAuth implementation snapshots. A reference search found no tracked source import of this directory. A high-confidence key/token scan found no credential values in these files. | Retain as historical source until an owner approves removal. | Preserved; not archived. |
| `.worktrees/` | Untracked in the original main checkout; registered worktrees | Active independent source and release work. Broad `git add -A` in `main` could stage nested worktree contents. | Keep registered and never stage wholesale. | The consolidation branch adds the root-anchored `/.worktrees/` ignore rule. It applies after that branch is integrated; `main` was not modified. |
| `.wrangler/` | Ignored; 40 files, generated bundles/maps plus local state and logs | Dry-run bundles/maps can be recreated from source. SQLite state, logs, and caches may contain operational or local data. | Generated bundles are recreatable; local state/logs are `RETAIN_PENDING_REVIEW`. | Preserved in place; no archive. |
| `diagnostics/` | Untracked; four files | Contains the standalone connectivity probe and `p01-source-recovery/production-worker-version.json` (recovered production Worker source, about 2.67 MB). This is operational source evidence and is not part of the candidate. | `RETAIN_PENDING_REVIEW`; do not copy into a release or archive. | Preserved and excluded from the candidate. The candidate adds a narrow ignore for this recovered JSON only; diagnostic source and tests remain trackable. |
| `docs/` | Tracked; existing local WABA documentation changes | Architecture, readiness, roadmap, and runbook evidence. | Preserve and keep deployment state explicit. | Original changes preserved; new cleanup docs exist only in this worktree. |
| `migrations/` | Tracked directory with local WABA migration 0042 present as untracked in the main checkout | Historical schema source; migration 0042 must not be replayed against production because production history is pre-0042. | Preserve; separate local candidate migration from any remote operation. | No migrations run. |
| `release/` | Tracked; seven files | Historical M1 audit, migration, release, and test evidence. | Preserve as historical. | No changes. |
| `release-snapshots/waba-p04-m2-20261105/` | Untracked source snapshot | Historical P0-4 release snapshot. | Preserve; do not treat it as the integrated candidate. | No changes. |
| `src/` and `tests/` | Tracked with pre-existing WABA edits and untracked WABA files in the main checkout | Active implementation and tests. | Preserve exact dirty state. | No changes to the original checkout. |
| `node_modules/` | Ignored generated dependency installation | Re-creatable from the lockfile; shared root install was not replaced. | Recreate with `npm ci` where needed. | New candidate received its own lockfile-based install. |
| `package.backup.json` | Tracked, 805 bytes; no tracked source references found | Historical package configuration snapshot; no secret-value pattern found. | Retain pending owner review. | Preserved. |
| `wrangler.backup.jsonc` | Tracked, 624 bytes; no tracked source references found | Historical Worker configuration snapshot; no secret-value pattern found. | Retain pending owner review. | Preserved. |
| `.dev.vars` | Ignored and not tracked; 29 bytes | Local development variables; content was not read. | Keep private and ignored. | Preserved; not copied. |

## Other root status preserved

The original main checkout already had modified architecture/readiness/roadmap docs; WABA routes, onboarding, inbound/outbound and persistence modules; WABA tests; and untracked WABA lifecycle, diagnostic, migration, test, and release-snapshot files. Those files were not reset, cleaned, or overwritten. The complete status remains available with `git status --short` in the original checkout.

## Registered worktree disposition

Status counts are from the post-source-commit inspection. `Changed vs candidate` compares each worktree's tracked modifications and nonignored untracked files by relative-path SHA-256; ignored local state is excluded. A content mismatch is not a semantic merge, so dirty worktrees are retained even when their paths appear in the candidate. No merge/rebase/cherry-pick operation was in progress. The candidate source commit is `763937b`; `fusionlab360-core-c2e` pointed to an ancestor of `main` before its safe normal removal.

| Path | Branch / HEAD | Tracked / untracked / ignored files | Changed vs candidate (same / different / unique paths) | Disposition and reason |
|---|---|---:|---:|---|
| Main checkout `D:\Important Fusion Migration\fusionlab360-core` | `main` / `9381fb84` | 17 / 1,243 / 7,304 | Not compared; original dirty checkout | `KEEP_ACTIVE` — preserve all original dirty WABA changes. |
| `.worktrees\fl360-clean-consolidation` | `integration/fl360-core-consolidated` / `763937b` source commit | 0 / 0 / 3,574 | Canonical candidate | `KEEP_ACTIVE` — authoritative local consolidation; clean after source commit. |
| `.worktrees\ipaas-completion-remediation` | detached / `9381fb84` | 11 / 6 / 0 | 14 / 1 / 2 | `KEEP_UNMERGED` — 14 manifest files match; `src/config/app.ts` is the deliberate merged hunk; its unique register/manifest files remain in the source worktree. |
| `.worktrees\p02-ghl-page` | detached / `9381fb84` | 34 / 2 / 3,474 | 3 / 20 / 13 | `KEEP_UNMERGED` — P0-2/P0-3 lifecycle/page work is distinct; 13 changed paths are absent from the candidate. |
| `.worktrees\security-s1` | `codex/security-s1` / `9381fb84` | 35 / 9 / 0 | 0 / 35 / 9 | `KEEP_UNMERGED` — S1 implementation is intentionally excluded and has uncommitted source. |
| `.worktrees\waba-integrated-release` | detached / `9381fb84` | 21 / 19 / 3,497 | 7 / 22 / 11 | `KEEP_ROLLBACK` — release-source worktree has 11 unique changed paths and local Wrangler state. |
| `.worktrees\waba-integration-recovery` | detached / `9381fb84` | 13 / 30 / 3,473 | 40 / 3 / 0 | `KEEP_ROLLBACK` — original WABA source is preserved; ignored local state remains and three files differ from the consolidated port. |
| `.worktrees\waba-m2-identity-verifier` | detached / `9381fb84` | 8 / 16 / 3,472 | 16 / 7 / 1 | `KEEP_UNMERGED` — one unique changed path and local Wrangler state remain. |
| `.worktrees\waba-p04-release` | detached / `9381fb84` | 8 / 14 / 3,485 | 15 / 7 / 0 | `KEEP_ROLLBACK` — verified P0-4 release source/history and local Wrangler state. |
| `.worktrees\waba-readonly-canary` | detached / `9381fb84` | 13 / 7 / 3,473 | 4 / 9 / 7 | `KEEP_ROLLBACK` — working protected Preview source and unique files remain. |
| `.worktrees\waba-readonly-management` | detached / `9381fb84` | 8 / 10 / 3,479 | 5 / 12 / 1 | `KEEP_UNMERGED` — one unique path plus independent UI work remains. |
| `.worktrees\waba-s1-p04-integration` | `codex/waba-s1-p04-integration` / `9381fb84` | 44 / 29 / 3,472 | 13 / 45 / 15 | `KEEP_UNMERGED` — Security S1/P0-4 integration remains separate with 15 unique paths. |
| `D:\Important Fusion Migration\fusionlab360-core-p01-release` | detached / `9381fb84` | 2 / 2 / 3,367 | 2 / 2 / 0 | `KEEP_ROLLBACK` — P0-1 release source is a rollback/provenance artifact; preserve its ignored state. |
| `D:\Important Fusion Migration\fusionlab360-core-c2e` | detached / `1c3cdeaa` | 0 / 0 / 3,367 before removal | 0 / 0 / 0 | `SAFE_TO_REMOVE`, removed with normal `git worktree remove` (no force): commit is an ancestor of `main`, no source changes or untracked files existed, `.wrangler` held zero files, and all ignored files were `node_modules`. |

The original `main` and all remaining dirty/rollback worktrees are retained. No branch was deleted. `codex/security-s1` and `codex/waba-s1-p04-integration` remain checked out with uncommitted changes. The candidate source commit and clean status are recorded in the release-source register; this cleanup-register update is a documentation-only commit on the same candidate branch.

## Ignore and local-state policy

The candidate's `.gitignore` covers `.env`, `.env.*`, `.dev.vars`, `node_modules`, `.wrangler`, `.local-m3b3`, SQLite files, logs, build outputs, coverage, and cache directories. It now also ignores only the root `.worktrees/` container and the recovered `diagnostics/p01-source-recovery/production-worker-version.json`; it does not ignore all diagnostics, tests, or migrations. `git check-ignore` confirmed `.dev.vars`, `.wrangler`, `node_modules`, and the recovered JSON rule. `.dev.vars` is not tracked. A tracked SQLite-named file is a `.sqlite.test.ts` source test, not a database artifact.

## Secret/private-data scan

A non-printing pattern scan covered all 642 manifest files plus the three administrative registers. It found no private-key, AWS/GitHub/Slack/Meta/Google API-key, or JWT pattern. Five bearer-shaped occurrences were confined to a historical test-fixture review and three test files. They are mock/assertion fixtures (the OAuth test's value occurs in its mocked `access_token` response and a header assertion); no production credential value was found or emitted. This remains a heuristic scan, not proof that every arbitrary secret format is absent.

The SQLite simulator/cache files and recovered Worker source JSON remain protected by retention rather than being copied or declared clean. The source recovery JSON, temporary probes, and local database state were excluded from the consolidation candidate.

## Duplicate and generated-file decisions

- The ten `.oauth-refresh-backup/*.ts` files have no tracked source import reference. They are historical snapshots, not proven disposable duplicates; retain.
- `package.backup.json` and `wrangler.backup.jsonc` have no tracked source references. Their age/owner is uncertain; retain.
- `.wrangler` dry-run bundles and maps are generated and can be recreated, but were not removed because the task prohibits deleting historical/user artifacts. Keep simulator DBs and logs pending review.
- `node_modules` can be recreated from `package-lock.json`; it remains a local generated dependency directory.
- No item was proven both non-sensitive and non-operationally disposable enough to archive. No archive was created and no user or historical file was deleted.

## Actions taken

Created `.worktrees/fl360-clean-consolidation`, ported the reviewed iPaaS redactions and tests, added the reproducible manifest generator and ignore rules, and removed only the proven-safe `fusionlab360-core-c2e` worktree. The candidate's source commit and final release-register commit are recorded in `FL360_RELEASE_SOURCE_REGISTER.md`. No Cloudflare resource, D1 database, GHL setting, secret, or original WABA/iPaaS worktree was changed.

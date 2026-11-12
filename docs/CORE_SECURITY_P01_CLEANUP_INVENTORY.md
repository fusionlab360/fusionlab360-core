# Core source cleanup inventory

Baseline: `integration/fl360-core-consolidated` at
`c703950c1ee9a3f46c9e999fc47bdcfcd5320e43`. Git listed only the canonical
working directory. Paths below are relative to that directory. Sizes are
logical file bytes measured before this task's additions. Runtime state and
diagnostic bodies were classified through metadata.

| Path | State and size | Classification | Dependency and disposition |
|---|---|---|---|
| `.local-m3b3/` | Ignored, 9 files, 1.57 MiB | REQUIRES_REVIEW | Local simulator state. Recreating its schema would not reproduce its data. Preserve pending an owner decision on retention. |
| `.worktrees/marketplace-verifier-release/` | Ignored, 611 files, 4.37 MiB | REQUIRES_REVIEW | No registered worktree points here. It is a residual release directory, with config preservation previously recorded. Registration absence alone does not establish that its remaining bytes are preserved. |
| `.wrangler/state/` and `.wrangler/local-config/` | Ignored, 31 files, 1.75 MiB | REQUIRES_REVIEW | Local state and configuration can contain unique data or sensitive settings. Preserve. |
| `.wrangler/deploy-preview/`, `.wrangler/p02-dry-run/`, `.wrangler/p04-p01-baseline-dry-run/` | Ignored, 9 files, 16.54 MiB | REQUIRES_REVIEW | Generated bundles, maps, and notes. P02 and P04 JavaScript is byte-identical, but their maps differ. Preserve each release artifact set until a release owner confirms which original inputs and artifact provenance must be retained. |
| `.wrangler/tmp/` and `diagnostics/meta-connectivity-probe/` | Ignored local Wrangler remnants, 0 files | SAFE_TO_DELETE | Empty of files at inventory time. There are no file bytes to reclaim. |
| `diagnostics/p01-source-recovery/production-worker-version.json` | Ignored, 2.55 MiB | KEEP | Unique production source recovery evidence. The GM Metro evidence record refers to it. Preserve in place with existing access controls. |
| `docs/` | 49 tracked files, 0.54 MiB | KEEP | Engineering rules, active runbooks, and unique findings and decisions. The [documentation index](README.md) points readers to current procedures and dated evidence. Existing documents retain their paths and content. |
| `node_modules/` | Ignored, 3,574 files, 205.91 MiB | KEEP | Current local toolchain and runtime dependencies. The lockfile supplies a reinstall path. There is no operational reason to remove the installed tree. |
| `release/` | 7 tracked files, 0.15 MiB | KEEP | M1 candidate, manifests, tests, and migration and rollback evidence. The release candidate and consolidation records refer to these files. |
| `release-snapshots/waba-p04-m2-20261105/` | Local snapshot tree, no tracked or ordinary untracked entries, 3,473 files, 203.74 MiB | KEEP | Registered in the cleanup record as release material. The bulk is ignored dependency and Wrangler content. Preserve the whole snapshot pending an owner-reviewed recovery check. |
| `scripts/` | 4 tracked files, 19,524 bytes before the runner addition | KEEP | Includes source manifest generation, WABA verification and fixtures, and a connection operator script. These are active tool or release inputs. |
| `CONSOLIDATED_CANDIDATE_MANIFEST.sha256` | Tracked, 72,341 bytes | KEEP | Consolidated release provenance. The manifest generator and release source register refer to it. A regenerated manifest would describe a different candidate. |
| `INTEGRATION_CANDIDATE_MANIFEST.sha256` | Tracked, 70,511 bytes | KEEP | Integration candidate provenance retained in the release register. |
| `P04_SOURCE_MANIFEST.txt` | Tracked, 69,259 bytes | KEEP | P04 source and archive recovery reference in the cleanup register. |
| `package.backup.json`, `wrangler.backup.jsonc` | Tracked, 805 and 624 bytes | ARCHIVE | Historical configuration in the cleanup register. No active runtime dependency was established. Preserve in place until an owner approves an archive move and reference updates. |
| `package-lock.json` | Tracked, 55,929 bytes | KEEP | Reproducible dependency installation and release review input. |
| `.oauth-refresh-backup/` | 10 tracked files, 31,636 bytes | ARCHIVE | Prior OAuth implementations. The previous cleanup found no imports. Preserve originals as historical source pending an approved archive disposition. |
| `.dev.vars` | Ignored, size not collected | KEEP | Protected local configuration. Contents were not opened. |
| `docs/reports/historical/core-consolidation-20261024/temporary-scripts/` | Tracked historical files | KEEP | Includes a `.bak` that documents earlier consolidation work. Leave tracked historical evidence in place. |

No files were removed or relocated. Storage reclaimed: 0 bytes. For a future
cleanup, review the ignored Wrangler artifact sets and the Marketplace
residual directory first. Review archive placement for the tracked backup
files separately, with reference updates and recovery verification.

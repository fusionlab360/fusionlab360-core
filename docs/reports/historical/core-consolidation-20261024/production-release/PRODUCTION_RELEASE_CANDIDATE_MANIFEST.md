# Production Release Candidate Manifest

Date: 2026-10-24

Status: `BLOCKED`

## Baseline

- Repository: `D:\Important Fusion Migration\fusionlab360-core`
- Branch: `main`
- HEAD: `d1c1011299abdcb3be07a779582e1a39deb4ade7`
- Active Worker baseline: `16524281-c8b9-40e1-8a53-276ad2dd5833`
- Production D1: `fusionlab360-db` / `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`
- Fresh Time Travel bookmark: `00001ec3-00000000-0000510e-09428b5ba1c7c2bd932f3c749147bbcb`

## Migration hashes

- Original transaction-wrapped 0035 preserved in the verified backup: `23A8E81D3A21014D79BB8D199BDA0E7502F4E6E5C279BB3F0DA9B8E4D86FB2BB`.
- Canonical corrected 0035 removes only `BEGIN` and `COMMIT`: `A84A841F950F67F8401543AB9FDBC55B990990DEDED19AE664A1E7FEA2028131`.
- Corrected 0040 OFF-by-default migration: `69246F006AAA0CE4471CEA55B59932EDE507E366E64F65F327452ED6DA935D04`.

The corrected 0035 was proven on disposable remote D1 through Wrangler's normal migration tracker. Staging already applied the wrapper-free equivalent; no staging migration is being reapplied.

## Candidate contents

No deployable candidate was produced. The source worktree contains more than 160 status entries, including broad tracked modifications/deletions and untracked source, tests and migrations. Several modified files span unrelated AI, booking, STAAH, messaging and integration behavior. A complete file copy would include unreviewed changes; a clean selective candidate requires a file/hunk inclusion decision. The original worktree was not reset, cleaned, stashed, committed or overwritten.

## Gate results

- TypeScript: passed.
- Focused migration/API-key/permission tests: 11 passed, 0 failed.
- Wrangler production dry run: passed; resolved `env.DB (fusionlab360-db)` and production bindings.
- Production migration tracker: 0028–0041 pending; no remote migration applied.
- Production counts: 4 tenants, 3 clients, 4 integrations.
- Production `ai_auto_reply`: 0 ON rows and 0 OFF rows before migration; corrected 0040 would create OFF rows only.
- Queue API: identity, producer, consumer, DLQ and retention verified; pause and backlog fields omitted. Metrics endpoint returned HTTP 401 for the Wrangler OAuth identity.
- Old Worker compatibility after schema changes: unverified.

## Deployment decision

Production migration and Worker deployment are blocked until:

1. A reviewable release candidate is assembled from explicitly approved files/hunks.
2. Queue delivery pause/backlog is independently verified through an authorized dashboard or API identity.
3. Compatibility of the current Worker with the migrated schema is established.

No production migration, deployment, restore, Queue mutation, credential change or provider call was performed.

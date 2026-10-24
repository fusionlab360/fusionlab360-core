# Production Migration Execution Plan

Date: 2026-10-24

Status: `PRODUCTION_DEPLOYMENT_BLOCKED`

The original stop conditions below are the pre-remediation baseline. The current follow-up evidence and remaining gates are recorded at the end of this document.

## Verified target

- Worker: `fusionlab360-core`
- D1: `fusionlab360-db`, ID `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`
- Current Worker: `16524281-c8b9-40e1-8a53-276ad2dd5833`
- Fresh bookmark: `00001eae-00000000-0000510e-71722a1f8f03620d3e9fb4ad346bf7c7`

## Disposable rehearsal

An in-memory Node SQLite rehearsal applied all 28 historical migrations through `0027`, seeded four synthetic tenants, three clients, one integration and one reservation, then applied `0028`–`0041` in order. Results:

- All 14 pending SQL files executed in SQLite.
- Tenant count preserved: 4 before and after.
- Foreign-key violations: 0.
- `PRAGMA integrity_check`: `ok`.
- `0040` produced four `ai_auto_reply` rows with `enabled=1`, proving that the migration would turn unknown tenants ON.

This validates SQL/data shape in SQLite only. It does not establish Cloudflare D1 transaction-wrapper compatibility for `0035`.

## Required safe sequence after blockers are resolved

1. Reconcile `wrangler.jsonc` production D1 name (`fusionlab360`) with Cloudflare's actual resource name (`fusionlab360-db`) while preserving the verified ID.
2. Rehearse `0035` with the actual D1 migration runner or obtain a supported migration reconciliation decision; do not edit the historical file casually.
3. Prepare an audited, idempotent pre-`0040` SQL operation that inserts `enabled=0` only for tenants missing `ai_auto_reply`, preserving explicit rows. Verify tenant count and state before applying.
4. Obtain a fresh bookmark immediately before any write and verify current migration state again.
5. Apply migrations with Wrangler's normal tracker, stopping on the first failure.
6. Verify schema, migration ledger, foreign keys, tenant/client/integration counts, grant counts and AI states.
7. Verify old Worker compatibility or deploy the new Worker only after schema validation.
8. Perform read-only smoke checks and monitor without generating customer-facing messages.

## Current stop conditions

- `0040` is unsafe without the precondition above.
- `0035` D1 compatibility is unverified.
- Production application rollback after schema change is unproven.
- Queue delivery pause/backlog is not available through the inspected Wrangler command.
- The checked-in production D1 binding name does not match Cloudflare's resource name, despite matching ID.

No production migration, deployment, Queue operation or restore was executed.

## 2026-10-24 blocker resolution evidence

### Migration 0040

The migration is unapplied in both known remote environments (staging and production). The pending source now inserts `ai_auto_reply` with `enabled=0` and retains `INSERT OR IGNORE`, so explicit ON and OFF rows are preserved and missing rows remain disabled. The focused regression test passed for explicit ON, explicit OFF, missing state and new-tenant defaults.

### Migration 0035 D1 compatibility

Disposable remote database: `fusionlab360-migration-0035-compat-20261024` (`662c3341-8f62-48c0-b605-21c3f71d3819`). Wrangler applied migrations 0001–0034 through the normal tracker. The exact current Core 0035 hash is `23A8E81D3A21014D79BB8D199BDA0E7502F4E6E5C279BB3F0DA9B8E4D86FB2BB`; applying it failed before recording the migration because Cloudflare D1 rejects SQL `BEGIN TRANSACTION`/`COMMIT` (API code 7500). No production or staging database was involved.

A disposable compatibility copy removed only the rejected transaction wrapper. Its hash is `A84A841F950F67F8401543AB9FDBC55B990990DEDED19AE664A1E7FEA2028131`. Applying that copy through Wrangler's normal tracker succeeded. Read-only checks confirmed 0035 was recorded once, the three provider-neutral messaging tables exist, and `PRAGMA foreign_key_check` returned no rows. The canonical migration remains unchanged; production requires an approved migration-history-safe compatibility decision before use.

### Queue and binding checks

The read-only Queue API identified `fusionlab360-ghl-inbound` (`74b4c169b4d54f41be1a0d0602653ec4`) with one producer and one consumer, both `worker:fusionlab360-core`, retention `86400` seconds, and DLQ `fusionlab360-ghl-dlq`. The API response omitted `delivery_paused` and backlog fields, so those safety values remain unverified and no Queue mutation was attempted.

The production D1 binding was corrected locally from the stale name `fusionlab360` to the Cloudflare resource name `fusionlab360-db` while preserving ID `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`. A production dry run resolved `env.DB (fusionlab360-db)` and production-only bindings; no deployment occurred.

### Release gate

Production remains blocked. The Core worktree contains extensive unrelated tracked deletions/modifications and untracked source, migration and test files, with stale `REBASE_HEAD` metadata. A clean, reviewable release candidate cannot be isolated from this tree without a separate inclusion decision. Queue pause/backlog is also not exposed by the supported read-only API. These gates must be resolved before any production migration or Worker deployment.

## Final execution preflight (2026-10-24)

- The canonical 0035 file is now the wrapper-free correction approved by the release instructions. Original hash: `23A8E81D3A21014D79BB8D199BDA0E7502F4E6E5C279BB3F0DA9B8E4D86FB2BB`; corrected hash: `A84A841F950F67F8401543AB9FDBC55B990990DEDED19AE664A1E7FEA202813`.
- Fresh production bookmark: `00001ec3-00000000-0000510e-09428b5ba1c7c2bd932f3c749147bbcb`.
- Production Worker remains `16524281-c8b9-40e1-8a53-276ad2dd5833`; counts remain 4 tenants, 3 clients and 4 integrations. No `ai_auto_reply` rows exist before migration, so corrected 0040 will create OFF rows only.
- Queue `GET /queues/{id}` confirmed identity, producer, consumer, DLQ and 86400-second retention, but omitted `delivery_paused` and backlog. The metrics endpoint returned HTTP 401 for the Wrangler OAuth identity. Queue state is therefore not verified.
- `PRODUCTION_RELEASE_CANDIDATE_MANIFEST.md` records why the dirty worktree cannot safely become a production artifact. Old Worker compatibility after schema mutation is also unverified.

The production execution gate remains closed. No migration or deployment command was run.

## M1 readiness audit (2026-10-24)

The M1 audit created `release/M1_CORE_AUDIT.md`, `release/M1_RELEASE_CANDIDATE.md`, `release/M1_TEST_RESULTS.md`, `release/M1_GO_NO_GO.md` and `release/M1_MIGRATION_AND_ROLLBACK_PLAN.md`. The current worktree test inventory ran 618 tests with 0 failures, but no isolated candidate was created because the source contains mixed tracked deletions and untracked replacements across runtime areas. Production Worker compatibility after schema mutation and Queue pause/backlog remain unverified. M1 decision: `M1_RELEASE_NO_GO`.

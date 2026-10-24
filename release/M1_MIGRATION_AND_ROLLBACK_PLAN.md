# M1 Migration and Rollback Plan

## Candidate baseline

The deployable source snapshot is `D:\FusionLab360-Releases\core-rc-20261024` with manifest SHA-256 `B1222B4FC5A541E1C0C7B158FDC2A7685F1CECED4FD7E64F2B082E8679D6C689`. The canonical worktree remains untouched by release validation.

## Required preconditions before production

1. Resolve the test-reconciliation decision for the 53 deleted historical test files and the changed AI answerability expectation.
2. Confirm the old production Worker version `16524281-c8b9-40e1-8a53-276ad2dd5833` tolerates the post-migration schema. Metadata is available; its source bundle is not.
3. Establish old/new Queue envelope, consumer and retry compatibility and obtain authorized pause/backlog evidence. The current contract uses version `1` envelopes with provider/kind/source-event validation and D1 reloads; old consumer behavior is not proven.
4. Validate migrations `0028` through `0041` against a D1-compatible populated 0027-equivalent dataset. SQLite rehearsals passed and corrected 0035 was proven on disposable D1, but the complete populated upgrade is not.
5. Obtain a fresh Time Travel bookmark immediately before any production write and confirm a supported recovery path. Full SQL export is unavailable because production contains FTS5 virtual tables; restore has not been tested.

## Migration sequence

Use Wrangler's normal production tracker against `fusionlab360-db` only, in recorded order `0028`, `0029`, `0030`, `0031`, `0032`, `0033`, `0034`, corrected `0035`, `0036`, `0037`, `0038`, `0039`, OFF-by-default `0040`, `0041`. Stop on the first error. Never add tracker rows manually and never rerun a recorded migration.

After each migration, verify the tracker and affected schema. After the chain, verify tenant/client/integration counts, reservation preservation, foreign keys, messaging indexes, service grants, AI settings and quick-check results.

## AI safety

Migration 0040 must use explicit `enabled=0` for missing `ai_auto_reply` rows. Existing explicit ON/OFF rows remain untouched. Unknown tenants must not be automatically activated. Automatic sends must recheck the feature state immediately before delivery, including queued/delayed work.

## Application rollback

If the new Worker fails before schema-dependent traffic is enabled and old/new compatibility has been proven, restore the previous Worker version through a separately approved deployment operation. Do not assume application rollback repairs a schema mismatch.

## Database recovery

Do not automatically restore D1. Full SQL export is unavailable because production contains FTS5 virtual tables. Time Travel bookmarks are available, but restore permission and restore execution have not been tested in this audit. Any database restore requires separate approval and an explicit recovery decision.

No production migration or deployment was executed during M1.

## M1C compatibility update

The populated remote rehearsal used disposable D1 `fusionlab360-m1c-rehearsal-20261024` (`739c21ae-3fef-4b90-8437-d1b2bf811e24`). Wrangler applied 0001–0027, synthetic data was seeded, then 0028–0041 applied exactly once. No migrations were pending afterward; quick check was `ok`, foreign-key check returned no rows, and the synthetic AI state remained `ai_auto_reply=0`. This is strong D1 execution evidence, but it is not production data or production migration approval.

The legacy queue envelope contract remains accepted by the candidate. The candidate adds reservation and Meta envelope kinds that the old consumer does not recognize. Because Queue backlog contents and pause state are not available through the current read-only identity, a mixed-backlog safety proof is still required before production schema migration or Worker rollout.

The old deployed Worker metadata is available, but its source bundle was not recoverable through supported Wrangler commands or protected repository backups. Application rollback therefore remains conditional on obtaining that artifact or an equivalent compatibility proof.

## M1D final go/no-go resolution (2026-10-24)

### AI expectation

The historical `handoff` assertion was executed against the unchanged `resolveCoreAIAnswerability` implementation and failed with actual `answer_partial`. The active implementation in `src/domain/messaging/ai-chat-service.ts` documents and returns a grounded partial answer when approved intent coverage is complete but requested attributes are not confirmed. The related `tests/domain/messaging/ai-chat-service.test.ts` assertions cover the same behavior. The separate `src/domain/messaging/ai-answerability.ts` policy helper is not the active imported implementation. The candidate therefore retains the evidence-backed `answer_partial` assertion; no AI source change was made.

### Queue compatibility revision

A new `NEW_QUEUE_ENVELOPES_ENABLED` binding was added to the M1D candidate revision and is explicitly `false` in production and staging configuration. Meta WhatsApp webhook publishing and scheduled reservation dispatch require this flag; a missing value fails closed. Legacy GHL version-1 envelopes continue to use `GHL_INBOUND_QUEUE_ENABLED` unchanged. The production default Worker composition does not register the STAAH local mock/reservation consumer. Focused queue, Meta, reservation and legacy GHL tests pass with explicit activation in synthetic fixtures.

This prevents the new candidate from publishing reservation or Meta envelopes during deployment or rollback. The candidate was never deployed, and current Cloudflare metadata identifies only the existing Worker as the production Queue producer. Queue metrics did not expose backlog/pause state, so mixed-envelope contents and operational pause state remain unverified.

### Rollback assessment

Migrations are additive or preserve legacy table names/columns and the old Worker version metadata points to the existing production bindings. Static source and migration evidence supports legacy contacts, reservations, integrations and GHL event paths. The prior Worker source artifact is not available for byte-exact runtime replay, and Cloudflare does not provide a source-download command for that version. Because critical old-worker runtime compatibility and Queue backlog state cannot be independently proven, rollback remains a release blocker.

**Decision: M1_RELEASE_NO_GO.**

### M1D candidate revision identity

The original frozen candidate at `D:\FusionLab360-Releases\core-rc-20261024` remains unchanged. The bounded revision is `D:\FusionLab360-Releases\core-rc-20261024-m1d` with 557 manifest files and manifest SHA-256 `B0249E72A12F39C609B58A3447590DC31DB924ED9087835C39FCAE34CAEFC68E`. Only the new envelope gate, its configuration, focused gate test, and explicit synthetic-fixture flag settings differ from the original candidate; all other candidate files are hash-identical.

### M1D final manifest correction

The focused Meta gate regression test was added after the first manifest calculation. The final M1D revision manifest remains 557 files and is now SHA-256 `0FF38ACE924B7860E9EDCE58F5F70A74DFE306EEA405CC602472829A831BE8B3`.

### Final M1D revision hash

The reproducible M1D revision is `D:\FusionLab360-Releases\core-rc-20261024-m1d`, with 557 manifest files and manifest SHA-256 `29AE65559CA2E15ABD203865F533B3CAF3BB6260A1EBC4203107B55D95E5146B`.

## M1D superseding decision

The earlier M1C paragraphs above are retained as historical evidence. M1D resolves the AI expectation in favor of the active `answer_partial` implementation and adds a default-off gate for new reservation/Meta Queue envelopes in the separate M1D candidate revision. The final M1D decision remains **M1_RELEASE_NO_GO** because the old Worker artifact cannot be replayed and Queue backlog/pause state is not exposed to the available identity. The final revision manifest is `29AE65559CA2E15ABD203865F533B3CAF3BB6260A1EBC4203107B55D95E5146B`.

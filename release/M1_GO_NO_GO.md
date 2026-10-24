# M1 Go / No-Go Decision

Decision: **M1_RELEASE_NO_GO**

The complete current Core working tree is now frozen in an external, hash-verified release candidate. The remaining NO-GO items are compatibility and operational evidence gaps, not the dirty canonical worktree itself.

| Gate | Result | Evidence |
|---|---|---|
| Exact reproducible release candidate | PASS | 556 included application files; source/candidate hashes match; manifest `B1222B4FC5A541E1C0C7B158FDC2A7685F1CECED4FD7E64F2B082E8679D6C689` |
| Secret/local-data exclusion | PASS | No private/runtime-named files; `.dev.vars`, local state and database material excluded; test bearer-like values are synthetic fixtures |
| TypeScript | PASS | Candidate `npm.cmd run typecheck` |
| Full current test tree | PASS with reconciliation limitation | 618 passed, 0 failed, 0 skipped across 81 files; 53 deleted historical tests have same-basename replacements, content equivalence not proven; modified answerability expectation remains a baseline exception |
| Migration chain SQL | PASS under SQLite | 0001–0041 and populated-0027-style upgrade rehearsed; integrity `ok`, zero FK violations |
| Cloudflare migration readiness | PASS for disposable rehearsal / production pending | New disposable D1 applied 0001–0041 through Wrangler; quick check and FK check passed; production tracker still pending 0028–0041 |
| AI safety | PASS for candidate source | 0040 inserts missing `ai_auto_reply` as disabled and runtime gates check feature state before automatic sends |
| Production bindings | PASS read-only | Wrangler dry run targets `fusionlab360-core` and `fusionlab360-db` only; no deployment |
| Old Worker compatibility after schema changes | UNKNOWN / BLOCKER | Version metadata is readable, but old source bundle and post-migration compatibility test are unavailable |
| Queue safety and old/new envelope compatibility | UNKNOWN / BLOCKER | Queue metrics API returned 401 and pause/backlog fields were omitted; current envelope contract is documented, but old consumer behavior cannot be proven |
| Rollback evidence | PARTIAL | Prior Worker version and Time Travel bookmarks exist; full SQL export is blocked by FTS5 and restore is untested |
| Destructive-operation requirement | PASS | No production mutation, deployment, migration, Queue or secret change performed |

## Required decisions before GO

1. Obtain an authorized, read-only way to inspect the old Worker artifact or otherwise prove it tolerates the post-migration schema.
2. Establish old/new Queue envelope and retry compatibility with an approved artifact or controlled staging evidence; obtain Queue pause/backlog/consumer evidence from an identity that can read it.
3. Resolve the remaining test-only AI answerability expectation decision.

No production migration or deployment command is authorized from this M1 state.

## M1C final compatibility gate

- Test replacement coverage: **PASS** for the 53 path moves; all historical titles retained and assertion/test-case totals increased.
- AI answerability expectation: **UNRESOLVED DECISION**; test-only change conflicts with HEAD expectation while runtime code is unchanged.
- Remote populated D1 rehearsal: **PASS** on disposable D1 `739c21ae-3fef-4b90-8437-d1b2bf811e24`; 0001–0041 applied, synthetic rows preserved, quick check and foreign-key checks passed, AI auto-reply remained OFF.
- Old Worker rollback compatibility: **UNKNOWN**; source bundle for deployed version `16524281-c8b9-40e1-8a53-276ad2dd5833` is unavailable.
- Queue compatibility: **BLOCKED** for mixed-format certainty; legacy GHL envelopes are compatible, but the old consumer rejects candidate `reservation`/`meta_whatsapp` envelopes and backlog contents/pause state are unavailable through the current identity.

The candidate remains reproducible at manifest SHA-256 `B1222B4FC5A541E1C0C7B158FDC2A7685F1CECED4FD7E64F2B082E8679D6C689`. M1 remains `M1_RELEASE_NO_GO` until the old artifact and Queue mixed-backlog conditions are proven safe and the AI test expectation receives an explicit decision.



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

### M1D validation evidence

- Candidate revision typecheck: `npm.cmd run typecheck` passed.
- Candidate revision focused queue/Meta/STAAH tests: 57 passed, 0 failed.
- Candidate revision AI answerability and messaging tests: 57 passed, 0 failed.
- Candidate revision full explicit test discovery: 621 passed, 0 failed, 0 skipped.
- Candidate revision staging Wrangler dry run passed and showed only staging D1, staging Queue/DLQ, staging Vectorize and staging AI bindings; `APP_ENVIRONMENT=staging`, `GHL_INBOUND_QUEUE_ENABLED=false`, `NEW_QUEUE_ENVELOPES_ENABLED=false`, `AI_BOOKING_ENABLED=false`.
- Canonical `git diff --check` and `git diff --cached --check` passed (line-ending warnings only).

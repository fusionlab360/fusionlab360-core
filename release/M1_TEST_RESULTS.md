# M1 Test Results

Date: 2026-10-24

## Candidate validation

Candidate: `D:\FusionLab360-Releases\core-rc-20261024`

| Command | Result |
|---|---|
| `npm.cmd ci --ignore-scripts` | Passed in candidate; lockfile dependencies installed |
| `npm.cmd run typecheck` | Passed |
| Batched `npx.cmd tsx --test --test-reporter=dot` over all 81 discovered `tests/**/*.test.ts` files | **618 passed, 0 failed, 0 skipped** |
| `node` SQLite rehearsal over migrations 0001–0041 | Passed: 42 files applied, `PRAGMA integrity_check` = `ok`, 0 foreign-key violations, required tenant/messaging/console tables present |
| SQLite upgrade rehearsal with synthetic tenant inserted after 0027, then 0028–0041 | Passed: tenant preserved, integrity `ok`, 0 foreign-key violations |
| `npx.cmd wrangler deploy --dry-run` | Passed; production Worker `fusionlab360-core`, D1 `fusionlab360-db`, Queue, Vectorize and AI bindings resolved; no upload/deploy performed |
| `git diff --check` (canonical source) | Passed; line-ending warnings only |
| `git diff --cached --check` (canonical source) | Passed |

The first dry-run attempt from the external path was blocked by sandbox filesystem policy while Wrangler created `.wrangler` and log files; the same read-only command passed with authorized external-directory access. The candidate itself was not changed by the dry run.

## Test-discovery reconciliation

- 53 tracked test files are deleted from their historical `src/**` paths.
- 79 untracked test files exist under `tests/**`.
- All 53 deleted test basenames have an untracked `tests/**` counterpart.
- The 618 passing result therefore covers the current replacement tree, but content equivalence to every historical test is not proven by basename matching alone.
- `npx.cmd tsx --test tests` remains a discovery failure because tsx resolves the directory to a missing `tests/index.ts`; explicit file enumeration was used instead.
- `tests/ai/answerability.test.ts` is modified relative to HEAD and currently expects `answer_partial` rather than the historical `handoff`; its current passing result is not baseline equivalence evidence.

## Migration evidence

- Corrected 0035 wrapper-free SHA-256: `A84A841F950F67F8401543AB9FDBC55B990990DEDED19AE664A1E7FEA202813`.
- Corrected 0035 was applied successfully on disposable D1 through Wrangler's normal tracker after the transaction-wrapped form failed with Cloudflare code 7500.
- Candidate SQLite rehearsals applied the full 0001–0041 chain and a populated-0027-style upgrade with synthetic data. This validates SQL and relational behavior under SQLite only; it is not proof of Cloudflare D1 production execution.
- Migration 0040 is OFF-by-default for missing `ai_auto_reply` rows; explicit ON/OFF rows are preserved by `INSERT OR IGNORE`.
- Production migration tracker remains pending 0028–0041; no production migration was executed.

## Production dry-run bindings

The dry run resolved `DB=fusionlab360-db` (D1 ID `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`), `GHL_INBOUND_QUEUE=fusionlab360-ghl-inbound`, both production Vectorize indexes, AI, `APP_ENVIRONMENT=production`, `AI_BOOKING_ENABLED=true`, and `GHL_INBOUND_QUEUE_ENABLED=true`. Secret values were not printed.

## Unverified or limited evidence

- The previous production Worker version `16524281-c8b9-40e1-8a53-276ad2dd5833` can be viewed for metadata and bindings, but Cloudflare did not provide its source bundle through the read-only version API. Compatibility of that old artifact with the post-migration schema is therefore **UNKNOWN**.
- Queue metrics returned HTTP 401 for the current Wrangler identity, and the Queue API omitted pause/backlog fields in the available response. Producer/consumer names, retention and DLQ are known from configuration and Worker metadata, but old/new envelope compatibility and live consumer behavior are not independently proven.
- Full production SQL export remains unavailable because the database contains FTS5 virtual tables. Time Travel bookmarks exist, but restore execution/permission is untested.
- No live provider call, Queue mutation, migration or deployment was performed.

## Additional read-only Queue evidence

`npx.cmd wrangler queues list` confirmed the production queue `fusionlab360-ghl-inbound` (ID `74b4c169b4d54f41be1a0d0602653ec4`) has one producer and one consumer, both `worker:fusionlab360-core`; `fusionlab360-ghl-dlq` exists. `wrangler queues info` confirmed the same producer/consumer identity. The configured retention is 86,400 seconds from the reviewed deployment configuration. The available read-only responses still do not expose `delivery_paused` or backlog, so those states remain unverified.

## M1C compatibility gate evidence

### Remote populated D1 rehearsal

A new disposable database was created only for this rehearsal:

- Name: `fusionlab360-m1c-rehearsal-20261024`
- ID: `739c21ae-3fef-4b90-8437-d1b2bf811e24`

Wrangler applied migrations `0001–0027`, then synthetic rows were inserted for a tenant, API client, GHL integration/credential fixture, reservation, feature settings, knowledge source/document and durable event. Wrangler then applied exactly the pending `0028–0041` sequence. A subsequent `d1 migrations list` reported no migrations to apply.

Read-only verification passed:

- `PRAGMA quick_check`: `ok`
- `PRAGMA foreign_key_check`: zero rows
- Synthetic counts preserved: 2 tenants, 2 clients, 2 integrations, 1 reservation, 3 feature settings, 1 knowledge source, 1 knowledge document and 1 durable event
- Provider-neutral messaging, grant and feature tables exist
- Synthetic tenant retained `ai_chat=1` and `ai_auto_reply=0`
- Knowledge FTS virtual tables and triggers remain present

The rehearsal database contains synthetic data only and was not used for application traffic.

### Test coverage reconciliation

The 53 deleted historical test paths map one-to-one to `tests/**` replacements by source-to-tests path transformation. The replacements preserve all 367 historical test titles and increase measured assertion tokens from 3,128 to 3,806 and test cases from 367 to 418. No replacement had fewer test cases, fewer assertion tokens or lost historical test titles in the comparison.

The separate modified `tests/ai/answerability.test.ts` intentionally changes one expectation from `handoff`/`no_requested_attribute_coverage` to `answer_partial`/`partial_knowledge_coverage`. The implementation in `src/domain/messaging/ai-chat-service.ts` is byte-identical to HEAD, so this is a test-only behavior change and remains a release decision item; it was not changed by M1C.

### Old Worker compatibility

Read-only `wrangler versions view` confirmed the old Worker version and its production D1/Queue bindings, but the supported Wrangler surface exposes metadata only; no script-content download command is available. No archived source matching the version was found in the repository or protected backup records.

A bounded static comparison is favorable for legacy paths: migrations 0028–0041 preserve existing reservation, credential, tenant and client structures; 0035 preserves the legacy messaging table names/columns; 0036–0038 add tables; 0039/0041 rebuild grants while copying existing rows; 0040 only inserts missing feature rows. The committed HEAD source has no references to the new Meta/provider-neutral tables or grant tables. Exact runtime compatibility of the deployed artifact remains unverified.

### Queue compatibility

HEAD and the candidate share the legacy version-1 GoHighLevel envelopes (`inbound`, `knowledge`, `event_replay`). The candidate additionally accepts `reservation` and `meta_whatsapp` envelopes. The old consumer rejects those new kinds because its validator requires `provider=gohighlevel` and has no corresponding handlers. Queue metadata confirms one producer and one consumer for `fusionlab360-ghl-inbound`, with DLQ `fusionlab360-ghl-dlq` and 86,400-second retention, but the available API does not expose backlog contents or delivery pause state. Therefore it is impossible to prove that no new-kind messages are queued or that an old consumer can safely drain a mixed backlog.

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

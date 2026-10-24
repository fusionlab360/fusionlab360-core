# M1 Release Candidate

Status: `SNAPSHOT_CREATED_AND_HASH_VERIFIED`

## Candidate

- Directory: `D:\FusionLab360-Releases\core-rc-20261024`
- Source repository: `D:\Important Fusion Migration\fusionlab360-core`
- Source branch: `main`
- Source HEAD: `d1c1011299abdcb3be07a779582e1a39deb4ade7`
- Included application files: `556`
- Candidate manifest: `D:\FusionLab360-Releases\core-rc-20261024\release\M1_RELEASE_CANDIDATE_MANIFEST.sha256`
- Candidate manifest SHA-256: `B1222B4FC5A541E1C0C7B158FDC2A7685F1CECED4FD7E64F2B082E8679D6C689`
- `package-lock.json` SHA-256: `5285FDBE11F4F586E9189C890C9C1C9FD1082E5FF72662389DEFD4EE5AB80D79`
- `package.json` SHA-256: `E3B425A6B8E96F258089F9DD756C0EF0FC49A4290A41893465EAA47F728798D3`
- `wrangler.jsonc` SHA-256: `69AF80808D35FF0BC674BBCBD296BF49E9615BC7F48325CF05B429BD0C627D28`

The candidate was copied from the complete current working tree with no source edits during the copy. Source/candidate comparison found zero missing files, zero extra application files and zero SHA-256 mismatches. The candidate contains the current untracked source, migrations and tests, including the synthetic STAAH schema fixture required by its test. The fixture is test schema only and contains no customer data.

Excluded from the candidate: `.git`, `node_modules`, `.wrangler`, `.local-m3b3`, `.dev.vars`, `.oauth-refresh-backup`, temporary relocation scripts, M6 review notes, and local database/secret material. No private or runtime-named files were present in the candidate. Three test files contain bearer-like strings, but their values are synthetic mock fixtures; no production credential was copied.

The candidate is immutable after the final manifest and validation evidence recorded here. Any correction requires a new candidate directory.

## Dependency and build provenance

Dependencies were installed in the candidate with `npm.cmd ci --ignore-scripts` using the recorded lock hash. A separate external copy of the existing Console API source was provided only to resolve the Core test's declared cross-workspace import; it is not part of the Core candidate or deployable Worker.

## M1C verification status

The frozen candidate was not modified. Its manifest SHA-256 remains `B1222B4FC5A541E1C0C7B158FDC2A7685F1CECED4FD7E64F2B082E8679D6C689`. M1C coverage comparison, remote D1 rehearsal and compatibility findings are recorded in `release/M1_TEST_RESULTS.md` and `release/M1_GO_NO_GO.md`.

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

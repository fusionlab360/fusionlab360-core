# NUVI Retrieval Baseline — 2026-10-16

## Status: blocked; no NUVI baseline was run

This report records a local readiness check. It does not present synthetic tests as a NUVI or production quality baseline.

## Verified repository facts

- The repository does not identify a verified NUVI tenant ID or approved NUVI knowledge source IDs in the inspected documentation and runtime configuration. Tenant IDs seen in prior traces or unrelated tests were not used as substitutes.
- `src/domain/messaging/retrieval-evaluation-cases.ts` defines 25 clinic-oriented benchmark cases. Every case is `draft`; the source references are logical labels such as `services:general`, not database IDs. The case-file instructions prohibit scoring draft labels as production metrics.
- `POST /knowledge/evaluate` is registered only when `shouldEnableNonProductionRoutes()` accepts `development` or `staging`. It is behind the existing authentication middleware and requires `knowledge:evaluate`.
- The endpoint gets the tenant ID from authenticated request context, not from its JSON body. It runs the existing tenant-scoped hybrid retrieval and deterministic selector. The inspected path reads D1/Vectorize and may invoke the configured AI reranker; it contains no evaluation-result persistence or knowledge mutation.
- The current runner reports retrieval and selection diagnostics. It does not run final answerability, customer-facing generation, grounding validation, or delivery. The older metric types in `retrieval-evaluation.ts` do not make those measurements part of this endpoint's runner.

## Work performed

No live or staging evaluation request was made. No production or remote data was accessed. The focused local evaluation/retrieval tests used synthetic fixtures only; they are regression checks, not a NUVI baseline.

Command:

```text
npx.cmd tsx --test src/domain/messaging/retrieval-evaluation.test.ts src/domain/messaging/retrieval-evaluation-cases.test.ts src/domain/messaging/retrieval-evaluation-runner.test.ts src/domain/messaging/retrieval-evaluation-controller.test.ts src/domain/messaging/tenant-knowledge-retriever.test.ts src/domain/messaging/knowledge-intelligence.test.ts src/domain/messaging/knowledge-query-context.test.ts
```

Result: 79 tests passed, 0 failed.

## Exact blocker

A valid baseline requires an operator to confirm the intended NUVI tenant in the target non-production environment and provide an approved mapping from the benchmark's logical source keys to that tenant's actual source/document IDs. Each mapped source and expected answerability label must be reviewed against its approved content. No such mapping or verified tenant identity is present in the inspected repository. All cases therefore remain drafts and no quality score is valid.

The current evaluation endpoint also cannot establish answerability, grounding, unsupported-claim rate, or delivery outcomes. A separate, explicitly approved end-to-end evaluation design would be needed for those measures; this task did not add one.

## Safe next steps

1. Have the environment owner confirm the intended NUVI tenant ID and a `development` or `staging` Worker/environment. Do not infer identity from a clinic label or prior trace.
2. Through the approved tenant-scoped knowledge inventory, identify approved sources and verify their content supports the cases they will label. Map only those real IDs to the logical case keys; keep unverified cases as drafts.
3. Confirm the operator's existing client has `knowledge:evaluate` and use the non-production endpoint. The tenant is selected by authenticated context; do not add a caller-supplied tenant ID.
4. Run only verified case IDs with the explicit source-key map and bounded `retrievalTopK`/`metricK`. Preserve the returned diagnostics and report retrieval/selection metrics only. Do not characterize these metrics as answer-generation or grounding results.

No files other than this report were changed for this baseline attempt.

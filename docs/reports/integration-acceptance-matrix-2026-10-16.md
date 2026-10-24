# Bounded Integration Acceptance Matrix — 2026-10-16

## Scope and result

Local acceptance checks only. Tests use synthetic tenant/source fixtures and doubles at external provider boundaries. No NUVI identity or production configuration is assumed. The focused test run passed **134/134 tests**. This is not a full inbound-to-index-to-answer-to-delivery end-to-end run.

| Acceptance behavior | Existing test evidence | Result and boundary |
| --- | --- | --- |
| Valid inbound webhook normalizes, resolves the provider location to the intended tenant, and publishes that tenant-scoped envelope | `src/domain/messaging/webhook-controller.test.ts` tests queue-acceptance helpers and invalid-signature rejection; `src/domain/messaging/inbound-queue.test.ts` tests batch dispatch with a stub processor | **Blocked as one integrated path.** No valid-signature controller test asserts normalization, trusted location-to-tenant resolution, and the published envelope together. |
| Invalid signature cannot publish an inbound event | `webhook-controller.test.ts`: `invalid GHL signature is rejected before Queue publication` | **Pass, controller-level test.** |
| Untrusted tenant/provider context cannot cross tenant boundaries | `tenant-knowledge-retriever.test.ts`: `tenant-scoped recovery excludes matching documents owned by another tenant`; `queue-dispatch.test.ts`: `knowledge-event lookup is tenant scoped`; queue consumer code compares the resolved provider-location tenant with envelope tenant and validates provider/envelope shape | **Pass at tested repository/retrieval boundaries; consumer mismatch path is not directly tested.** |
| Duplicate inbound events do not repeat AI or reply side effects | `inbound-service.test.ts`: `duplicate inbound event claim exits before handoff or reply side effects`; `integration-event-repository.test.ts` covers concurrent claims; `durable-processing.sqlite.test.ts` covers persistence and lease transitions | **Pass, service and real-SQLite repository tests.** |
| Valid knowledge event reaches its processing handler | `src/domain/messaging/inbound-queue.integration.test.ts` invokes the exported Worker Queue entry point with local SQLite D1 and synthetic tenant/provider/event records; it verifies Knowledge Base deletion reaches the real persisted-data handler, deletes the expected document vector, marks the document deleted, and completes the event lease | **Pass for the knowledge deletion processing path.** Create/update indexing via the Queue consumer is still not directly exercised as one path. |
| Knowledge-processing failure retries or reaches terminal handling | `queue-processing.test.ts` verifies handler failure is recorded and rethrown; `inbound-queue.test.ts` verifies Queue retry; `durable-processing.sqlite.test.ts` covers attempt limits, dead-letter transitions, and lease recovery | **Pass across service, Queue wrapper, and SQLite persistence tests.** The concrete indexer failure is represented by a deterministic handler failure double. |
| Supported question selects evidence and produces a grounded answer | `ai-chat-service.test.ts` covers branch address, hours, service, map-link and attribute-recovery scenarios; `knowledge-intelligence.test.ts` checks selection; `evidence-answer.test.ts` rejects unsupported claims | **Pass, actual answer/selection services with synthetic evidence and mocked model/provider boundary.** Retrieval backend and inbound Queue orchestration are not part of these answer tests. |
| Insufficient evidence and unsupported high-risk questions abstain | `ai-chat-service.test.ts` covers no-knowledge, partial answer, and high-risk restrictions; `evidence-answer.test.ts` rejects invalid or unsupported claims; `answer-service.test.ts` checks verification failure | **Pass, service/unit tests.** |
| Outbound delivery success and provider failure are handled safely | `outbound-delivery.test.ts` checks confirmed delivery deduplication and ambiguous failure is not resent; `gohighlevel/provider.test.ts` checks known pre-submission failures | **Pass, delivery service with memory D1/provider doubles.** No real GHL delivery is attempted. |
| Tenant, branch, and source constraints survive retrieval and selection | `tenant-knowledge-retriever.test.ts`, `knowledge-intelligence.test.ts`, and `ai-chat-service.test.ts` cover cross-tenant retrieval filtering, wrong-branch exclusion, selected prompt evidence, coverage, grounding, and trace agreement | **Pass, component/service tests with synthetic sources.** |
| NUVI-specific approved-source acceptance | No verified NUVI tenant/source mapping or approved benchmark cases are present in the repository; the evaluation cases remain drafts | **Blocked.** Requires confirmed target non-production tenant, approved source IDs/content, and reviewed expected labels. |

## Test execution

```text
npx.cmd tsx --test src/domain/messaging/webhook-controller.test.ts src/domain/messaging/inbound-queue.test.ts src/domain/messaging/inbound-service.test.ts src/domain/knowledge/queue-dispatch.test.ts src/domain/knowledge/queue-processing.test.ts src/persistence/repositories/integration-event-repository.test.ts src/persistence/repositories/durable-processing.sqlite.test.ts src/domain/messaging/tenant-knowledge-retriever.test.ts src/domain/messaging/knowledge-intelligence.test.ts src/domain/messaging/ai-chat-service.test.ts src/core/ai/evidence-answer.test.ts src/domain/knowledge/answer-service.test.ts src/domain/messaging/outbound-delivery.test.ts src/integrations/messaging/gohighlevel/provider.test.ts
```

Result: 134 passed, 0 failed.

## Final AI Chat readiness review — 2026-10-16

The review used synthetic records and local test bindings only. It did not enable tenant features, contact provider endpoints, or verify live quality.

| Readiness criterion | Result | Evidence / boundary |
| --- | --- | --- |
| Context-dependent follow-ups | **PASS** | `knowledge-query-context.test.ts` covers branch, service, location, date/day, ambiguity, topic reset, missing history, and cross-conversation rules. In the inbound path, `contextUsed` skips the provider rewrite and passes the resolved retrieval query forward. Provider failure falls back to that supplied contextual query. |
| Tenant and branch isolation | **PASS** | Retrieval and selection tests exclude other-tenant and forbidden-branch evidence; contextual history tests exclude other conversations and ambiguous entities. |
| Supported questions and grounding | **PASS** | AI chat/evidence-answer tests verify selected approved evidence reaches the prompt and unsupported claims fail validation. Fixtures and AI provider are synthetic/mocked. |
| Insufficient evidence and high-risk handling | **PASS** | Existing answerability, evidence-answer, and answer-service tests verify abstention, partial evidence rules, and high-risk restrictions. |
| Duplicate inbound events | **PASS** | Inbound service, durable repository, and SQLite lease tests verify duplicate claims do not repeat AI or delivery side effects. |
| Valid signed webhook through normalization, real tenant resolution, and Queue publication | **BLOCKED** | Existing controller test rejects invalid signatures, and publication behavior is tested separately. No private key or signed synthetic fixture matching the verifier's fixed GHL public key is present. The controller path cannot be validly signed locally without that fixture; no bypass or test-only auth seam was added. |
| Knowledge event through exported Worker Queue entry point | **PASS, bounded** | New local SQLite integration test runs the exported `queue` function through tenant/provider validation and the real Knowledge Base deletion handler. It also verifies duplicate delivery, provider mismatch terminal state, and handler failure retry. Create/update indexing is not covered through this same dispatch path. |
| Outbound delivery | **PASS** | Delivery tests cover confirmed success, deduplication, and ambiguous outcomes that must not be resent. No live GHL delivery occurred. |
| Provider failure diagnostics | **PASS, local** | Hybrid/rewrite tests verify failure categories and safe HTTP status survive aggregation without messages, prompts, or response bodies. The actual production provider failure cause remains **unknown**. |
| NUVI approved-source baseline | **BLOCKED** | Verified NUVI tenant/source mapping and approved benchmark cases remain unavailable. No tenant or data assumptions were substituted. |

### Contextual rewrite behavior

The real inbound caller bypasses model rewriting whenever the deterministic resolver marks context as used, so a successful model rewrite cannot erase that resolved follow-up context in that path. Missing or ambiguous context is handled by clarification before retrieval; self-contained questions continue through the existing rewrite and retrieval path. Unit tests verify contextual fallback on provider failure and the added provider diagnostics. No provider priority, timeout, model, prompt, retrieval threshold, or fallback policy changed in this task.

### Integrated boundaries and recommendation

The Queue integration test exercises the exported Worker Queue entry point and real persistence/knowledge-deletion service with test SQLite and a fake Vectorize boundary. Inbound webhook publication remains a composed set of controller rejection/publication tests rather than a successful signed controller-to-Queue run. No single test spans that valid signature, normalization, trusted tenant lookup, and publication. A suitable vendor-signed synthetic fixture or an explicitly approved test-key mechanism is needed before that path can be called verified.

The generic AI Chat decision, evidence selection, grounding, and delivery safeguards have broad synthetic regression coverage, but the requested signed inbound integration boundary remains unverified. The NUVI baseline and production Gemini failure are also external validation blockers. Recommendation: **NOT READY TO MOVE TO BOOKINGS** until the valid signed inbound flow is verified with an authorized non-production fixture. This does not establish a defect in production AI Chat or claim live quality.

### Current-worktree validation

Focused command:

```text
npx.cmd tsx --test src/core/ai/providers/hybrid.test.ts src/integrations/ai/gemini/provider.test.ts src/integrations/ai/cloudflare/provider.test.ts src/domain/messaging/knowledge-query-context.test.ts src/domain/messaging/ai-chat-service.test.ts src/domain/messaging/knowledge-intelligence.test.ts src/integrations/knowledge/vectorize/retriever.test.ts src/domain/knowledge/retrieval-service.test.ts src/domain/messaging/webhook-controller.test.ts src/domain/messaging/inbound-queue.test.ts src/domain/messaging/inbound-queue.integration.test.ts src/domain/messaging/inbound-service.test.ts src/domain/knowledge/queue-processing.test.ts src/domain/knowledge/queue-dispatch.test.ts src/persistence/repositories/integration-event-repository.test.ts src/persistence/repositories/durable-processing.sqlite.test.ts src/domain/messaging/tenant-knowledge-retriever.test.ts src/core/ai/evidence-answer.test.ts src/domain/knowledge/answer-service.test.ts src/domain/messaging/outbound-delivery.test.ts src/integrations/messaging/gohighlevel/provider.test.ts
```

Result: **191 passed, 0 failed**. Also passed `npx.cmd tsc --noEmit`, `git diff --check`, and `git diff --cached --check`.

No runtime defect was demonstrated in this final review; the only implementation addition was the focused local Queue-consumer integration coverage. No production or remote resource was accessed or changed.

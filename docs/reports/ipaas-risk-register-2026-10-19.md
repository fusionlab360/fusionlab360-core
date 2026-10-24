# FusionLab360 Core Risk Register

**Date:** 2026-10-19
**Scope:** Read-only local audit; no production data accessed.

| ID | Severity | Confidence | Evidence | Impact | Smallest correction | Verification |
|---|---|---|---|---|---|---|
| R-01 | P1 | High | `src/domain/contact/service.ts:24,37,53,140` | Raw notes/events may expose PII. | Log counts/types and redacted IDs only. | Sensitive-log tests and staging sink review. |
| R-02 | P1 | High | `src/domain/contact/controller.ts:27` | Full create request may expose contact identity/custom fields. | Log field presence/schema only. | Request logging regression and staging review. |
| R-03 | P1 | Medium | `src/integrations/crm/gohighlevel/metadata.ts:101` | Full custom-field response may expose sensitive values. | Remove response dump; retain safe metadata. | Adapter redaction test. |
| R-04 | P1 | Medium | `src/integrations/messaging/gohighlevel/messages.ts:121–170` | History 400 can cause contextual retrieval failure/handoff. | Add status/envelope diagnostics; verify provider contract in staging. | Mock 400/envelope tests and controlled staging conversation. |
| R-05 | P2 | High | `src/persistence/repositories/credential-repository.ts:253–290`; migration 0027:9 | Missing migration could permit conflicting Location ownership. | Confirm migration in each environment; retain fail-closed ambiguity. | Concurrent two-tenant staging test. |
| R-06 | P2 | Medium | `src/middleware/authorization.ts` | Wildcard clients defeat least privilege. | Inventory routes and provision explicit scopes. | Permission matrix and operator preview. |
| R-07 | P2 | Medium | `src/domain/messaging/inbound-queue.ts:60–104` | Parallel batches and retries may increase queue age/provider pressure. | Measure before tuning concurrency. | Staging load/lease test. |
| R-08 | P2 | Medium | `src/domain/messaging/outbound-delivery.ts:24` | Multiple logical replies can have distinct effect keys. | Correlate event/effect/provider IDs before changing behavior. | Duplicate-delivery staging test. |
| R-09 | P2 | Medium | `src/middleware/providers/jwt.ts` and deployment config | Issuer/audience/rotation not fully verified here. | Confirm deployment settings and rotation policy. | JWT negative/expiry/tenant tests plus staging auth. |
| R-10 | P3 | High | `wrangler.jsonc:26,59,85,122` | Local `dev` references production DB ID with `remote:false`; config mistakes could target wrong binding. | Add config lint/document safe environment selection. | Static config check. |
| R-11 | P3 | Medium | `src/domain/messaging/inbound-service.ts` history fetches around lines 749 and 1345 | Two history calls add latency/failure surface. | Measure before optimization. | Timing diagnostics. |
| R-12 | P3 | Medium | `src/domain/knowledge/queue-processing.ts:5` and event repository | Aggregate status alone cannot prove stranded events. | Add safe age/lease/attempt metrics. | Lifecycle fixture. |

P1 findings should be addressed before broadening production log access. P2 findings need an explicit staging plan. P3 findings are hardening work. No item authorizes production changes.

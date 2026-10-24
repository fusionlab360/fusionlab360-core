# FusionLab360 Core Improvement Roadmap

**Date:** 2026-10-19

## Stage 0 — Evidence and release gates

Add privacy-safe GHL history diagnostics (status, API marker, envelope flags, correlation and elapsed time), queue lifecycle metrics, and config checks distinguishing production/staging/local bindings. Acceptance: transport vs normalization failures are distinguishable without message text, prompts, credentials, or source bodies. **Complexity:** small.

## Stage 1 — Privacy and least privilege

Redact contact service/controller payloads and GHL custom-field responses. Add tests for names, phones, DOB, identity numbers, notes, and custom values. Inventory client route usage and replace wildcard grants using the existing CLI. Acceptance: sensitive-log suite passes and operator previews show exact grants. **Complexity:** small/medium.

## Stage 2 — Isolation and event reliability proof

Confirm migration 0027 in staging; exercise concurrent Location assignment, two-tenant inbound/knowledge events, duplicate delivery, lease expiry, and dead-letter handling; correlate outbound effect keys with provider IDs. Acceptance: ambiguity fails closed, duplicate delivery does not duplicate effects, enqueue failure remains recoverable. **Complexity:** medium.

## Stage 3 — Provider-contract and AI/booking acceptance

Validate the GHL history contract with a test conversation. Load synthetic approved knowledge and verify contextual retrieval, attribute coverage, grounding, partial answers, and safe handoff. Exercise booking identity, patient-led slots, confirmed/pending/uncertain creation, cancellation readback, and rebooking using provider stubs then staging. Acceptance: selected evidence, prompt, answerability, grounding, and trace agree; provider mutations require readback. **Complexity:** medium/large.

## Stage 4 — Operations and measured scaling

Add dashboards/alerts for queue age, retries, leases, provider latency, history 400s, outbound unknowns, and dead letters. Run bounded staging load tests before tuning concurrency or retry windows. Document runbooks for replay, OAuth reauthorization, permission provisioning, and knowledge freshness. Acceptance: SLOs, alert thresholds, rollback, and tenant-isolation evidence are documented. **Complexity:** medium.

## Order and stop conditions

Complete Stage 1 before broadening production log access and Stage 0 before diagnosing the history 400 in production. Synthetic tests are not live quality proof. Stop if a proposed fix weakens tenant isolation, grounding, provider readback, or event idempotency.

No production deployment, remote mutation, OAuth initiation, migration execution, booking creation, or Git mutation was performed by this audit.

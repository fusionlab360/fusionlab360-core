# FusionLab360 Core Full iPaaS Audit

**Date:** 2026-10-19
**Mode:** Read-only local repository audit
**Scope:** Architecture, tenant isolation, authorization, integrations, event reliability, AI/booking safety, privacy, scalability, and test evidence.

## Files actually read

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_RULES.md`
- `docs/API_CLIENT_PERMISSIONS.md`
- `docs/GHL_LOCATION_OWNERSHIP.md`

No `AGENTS.override.md` exists in the repository. Existing reports under `docs/reports/` were preserved and not edited.

## Executive assessment

FusionLab360 Core has a coherent generic multi-tenant iPaaS shape: authenticated principals resolve tenant-scoped integration context, provider adapters translate external contracts, and asynchronous work is persisted and leased before processing. The strongest controls are tenant-bound client authorization, fail-closed GHL Location ownership, event leases, and evidence/booking verification.

The most material confirmed risks are privacy logging failures in contact paths, incomplete proof of the GHL conversation-history contract, and operational observability gaps around queue latency and provider outcomes. No local evidence proves a cross-tenant leak or duplicate provider mutation. Production behavior remains unverified because this audit made no remote calls.

## Architecture and dependency map

1. `src/bootstrap/routes.ts` builds the Hono app. `shouldEnableNonProductionRoutes` and `createApplication` are at lines 42–47; development/staging-only test routes are registered at lines 144–148 and 186–223.
2. `src/middleware/auth.ts` authenticates API keys/JWTs, resolves the client and tenant, and builds integration context. `src/middleware/authorization.ts` checks required scopes against both the principal and database client.
3. `src/persistence/repositories/credential-repository.ts:253–290` resolves GHL Location ownership with `LIMIT 2` and rejects ambiguity. `migrations/0027_enforce_ghl_location_ownership.sql:9` adds a partial unique index.
4. `src/domain/messaging/webhook-controller.ts` validates and queues inbound metadata. `src/domain/messaging/inbound-queue.ts:60–104` processes queue batches with bounded retry delays; `src/domain/knowledge/queue-processing.ts:5` uses the shared lease path.
5. `src/domain/messaging/outbound-delivery.ts:24` reserves durable effect keys before provider send and records sent/failed/unknown outcomes.
6. AI/knowledge orchestration keeps retrieval, selection, answerability, grounding, and provider operations outside the model. Booking uses explicit confirmation, identity gates, provider verification, and uncertain-outcome fencing.

## Route and authorization inventory

| Surface | Evidence | Assessment |
|---|---|---|
| `/`, `/health` | Public registration in `routes.ts:57–74` | Expected read-only operational surface; keep response minimal. |
| `/auth/*` | Public registration; handlers enforce auth/state | OAuth controller checks bearer/client permission and one-time state. |
| `/webhooks/gohighlevel/inbound` | Public provider ingress | Controller validates provider metadata and queues tenant-scoped work. |
| `/contacts/*`, `/reservations/*`, `/booking/*` | Auth middleware at `routes.ts:124–134` | Production operations remain protected by route scopes and principal checks. |
| `/integrations/*`, `/ai/*`, `/knowledge/*`, `/features*` | Auth/route scopes at `routes.ts:138–290` | Normal business routes remain available. |
| Test/evaluation routes | Gated by `shouldEnableNonProductionRoutes`; dedicated scopes remain | Local route tests confirm production hides these routes. |

`requirePermission` is fail-closed for missing context, tenant/client mismatch, and insufficient scopes; wildcard clients remain a least-privilege operational concern.

## Tenant isolation and credentials

The GHL Location path is fail-closed in application code: the repository asks for at most two owners, throws on more than one, then resolves a tenant. `assertLocationOwnership` protects provisioning and credential synchronization. Migration 0027 reinforces this at the database layer. Queue knowledge-event processing rechecks event tenant/provider/location before invoking handlers.

No cross-tenant leak was reproduced locally. Remote D1, Vectorize, provider APIs, and production records were not accessed. A staging test with two tenants and identical-looking provider identifiers is still required. JWT issuer/audience and key-rotation behavior also require deployment-level verification.

## Event and integration reliability

`handleGHLInboundQueueBatch` processes queue messages in parallel, uses bounded retries, and ACKs only terminal outcomes. Persisted events are claimed with lease and attempt checks; terminal mutations require tenant/event/lease identity. Outbound delivery reserves effect keys and disables automatic retry after unknown provider outcomes. Separate logical replies can still receive separate effect keys; local evidence does not prove duplicate customer-visible replies.

## GHL conversation-history HTTP 400

`src/integrations/messaging/gohighlevel/messages.ts:121–170` calls `GET /conversations/{encodedConversationId}/messages?limit=20` with `Version: v3` and expects nested `messages.messages`. `src/domain/messaging/inbound-service.ts` fetches history during initial processing and again after thinking (diagnostic around line 775). Both calls filter to the current conversation and log metadata only.

The source proves request construction but not the production 400 cause. No local fixture captures the failing provider status/body or validates account permissions, API-version requirements, conversation ID validity, or envelope differences. Root cause is **unverified**. The next safe measurement is status, API-version marker, envelope-presence flags, elapsed time, and correlation ID only.

## Confirmed privacy findings

- `src/domain/contact/service.ts:24,37,53,140` logs raw notes/events and serialized event data that can contain names, phone, DOB, identity numbers, and custom fields.
- `src/domain/contact/controller.ts:27` logs the full create-contact body.
- `src/integrations/crm/gohighlevel/metadata.ts:101` logs a full custom-field response.

Inbound history/webhook diagnostics are metadata-only; local sensitive-logging tests passed. No API key or access-token value was printed in the reviewed paths.

## Scorecard (0–5)

| Area | Score | Basis |
|---|---:|---|
| Generic architecture | 4 | Clear domain/provider/persistence boundaries. |
| Tenant isolation | 4 | Ambiguity rejection plus DB uniqueness; staging proof pending. |
| Authentication/authorization | 3 | Scope checks are strong; wildcard clients and deployment JWT settings remain. |
| Secrets/privacy | 2 | Confirmed contact/event payload logging risks. |
| Event reliability | 4 | Leases, bounded retries, idempotent persistence, durable outbound effects. |
| AI/knowledge safety | 4 | Evidence, grounding, and handoff controls present; live corpus unverified. |
| Booking safety | 4 | Identity, confirmation, readback, cancellation/rebooking safeguards present. |
| Observability | 3 | Correlation/version diagnostics exist; provider/queue timing gaps remain. |
| Tests | 3 | Focused local tests pass; no staging/provider acceptance. |
| Scalability | 3 | Conservative queue settings; provider limits need measured tuning. |

## Local validation

- `npx.cmd tsc --noEmit` — passed (exit 0).
- Authorization, booking-route, and sensitive-logging tests — 23 passed, 0 failed.
- Inbound queue integration tests — 3 passed, 0 failed.

No deployment, production endpoint, remote D1, queue replay, OAuth flow, or production data access occurred.

## Priority conclusions

1. Remove or redact contact/event payload logging before broad production use.
2. Capture privacy-safe GHL history failure diagnostics and verify the provider contract in staging.
3. Exercise two-tenant Location isolation, queue lease recovery, and duplicate outbound correlation in staging.
4. Replace wildcard client permissions with explicit grants after confirming route usage.
5. Treat live AI/booking quality as unverified until approved staging knowledge and provider fixtures exist.

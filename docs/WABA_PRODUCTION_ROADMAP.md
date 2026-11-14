# WABA production roadmap

**Purpose:** A minimal, gated path from the verified developer-test text pilot to one real-business WABA connection. Every milestone reuses the existing Worker, D1 repositories, canonical messaging, credential vault, integration events, and GHL adapter boundaries.

## Priority summary

| Priority | Milestone | Why it is required |
| --- | --- | --- |
| P0 | Production credential lifecycle and launch policy | A real asset must not send with an expired/unknown-lifetime credential. |
| P0 | Tenant-managed WABA pilot authorization | The present bridge is source-hardcoded to one test tenant/location/provider/recipient. |
| P0 | Edge/API security baseline | Global wildcard CORS and absent app-level rate control are not acceptable as launch assumptions. |
| P0 | Launch observability and recovery | Unknown sends are deliberately not replayed; operators need alerts and a recovery decision process. |
| P1 | Redaction, retention, and client support policy | Customer text and provider errors require defined handling before routine client use. |
| P1 | Production onboarding contract | A real client needs the approved authorization-code flow, Meta-admin prerequisites, and documented ownership. |
| P1 | Production messaging features | Templates, opt-out, media, and unsupported-input handling are not in the tested text pilot. |
| P2 | Multi-tenant rollout automation and reporting | Broader rollout needs managed onboarding, quota/cost insight, and scale testing. |

## P0-1 — Generic credential lifecycle safety

**Status: LOCALLY IMPLEMENTED; deployment and legacy-credential inventory remain separate release work.**

The existing vault metadata now has explicit lifecycle evidence. It accepts known-expiry credentials with a 60-second UTC skew margin, blocks missing/expired/unverified lifetimes before Graph dispatch, supports an explicitly attested verified non-expiring provider result, and preserves optimistic versioned replacement on the same connection. No D1 migration is required because metadata is already encrypted-credential-owned JSON. Credentials without expiry are not treated as permanent; existing legacy NULL/missing-expiry records will fail closed after deployment until safely replaced or independently verified. The current Graph onboarding provider does not yet attest a system-user token as non-expiring, so it deliberately writes `unverified_non_expiring` for that case and outbound blocks it.

P0-1 does not add automatic token rotation. It can be released with outbound disabled and without changing any production credential. Production onboarding of a verified non-expiring system-user credential remains a separate unresolved capability until trusted provider evidence is implemented and reviewed.

**Evidence:** `src/integrations/messaging/meta-whatsapp/onboarding.ts` can create generic credential metadata without an expiry; `src/integrations/messaging/meta-whatsapp/credential-vault.ts` checks expiry only when `developerTest === true`.

**Impact/severity:** Critical. The first real client could keep an active connection state with a credential whose expiry is unknown or has passed, causing unplanned delivery failures.

**Minimal change:**

1. Extend the existing `MetaWhatsAppCredentialVault` metadata contract to represent production expiry/renewability without storing token type or token plaintext outside the vault.
2. Require usable expiry metadata for the approved production onboarding path, or explicitly classify a provider-supported non-expiring credential after an authoritative verification step.
3. Make Meta outbound fail closed before Graph send when the active credential is expired or within an approved safety threshold.
4. Persist a safe lifecycle/error code and expose it through existing operational diagnostics; add an alerting query/runbook rather than auto-renewing arbitrary tokens.
5. Reuse existing optimistic `credential_version` replacement and connection reuse. Do not create another vault or token store.

**Reuse:** `MetaWhatsAppOnboardingService`, `MetaWhatsAppCredentialVault`, `MetaWhatsAppCredentialRepository`, `MetaWhatsAppOutboundService`, existing diagnostic/error conventions.

**Required tests:** generic expiry rejection; near-expiry warning state; credential replacement retains connection; cross-tenant credential isolation; delivery remains unknown-safe; no plaintext logging.

**Migration requirement:** Additive metadata/validation only if current JSON metadata can represent it. No destructive migration.

**Deployment risk:** An overly strict rule could disable an existing valid production credential. Use an explicit compatibility inventory and fail-closed rollout only after connection metadata is populated.

**Acceptance criteria:** The local code path enforces a verified credential-lifetime classification before Graph, expired credentials cannot invoke Graph, and replacement reuses the same connection. Before production rollout, inventory active credentials and add P0-4 visibility/runbook coverage for the stable lifecycle codes.

## P0-2 — Tenant-managed connection authorization

**Evidence:** `src/integrations/messaging/gohighlevel/provider-outbound-meta.ts` contains fixed pilot tenant/location/provider/phone/recipient constants. `gohighlevel-inbound-config.ts` and `custom-provider-pilot-config.ts` accept a single environment allowlist.

**Impact/severity:** Critical. A new real-business tenant requires source edits, environment changes, and deployment; blindly broadening the existing flags would weaken isolation.

**Minimal change:**

1. Define an additive tenant-owned connection capability using the existing integration/Meta connection records and repositories.
2. Store approved GHL location/provider association and inbound/human-outbound approval per connection.
3. Resolve authorization from the authenticated/resolved tenant and active connection—not headers, callback payload selection, or a caller-selected tenant.
4. Retain a global master kill switch and disabled-by-default connection status.
5. Backfill only the existing pilot after exact-record review; retain old pilot gates during the transition and remove them only in a separate review.

**Reuse:** `IntegrationRepository`, `MetaWhatsAppConnectionRepository`, `MessagingConversationRepository`, `resolveTenantByProviderLocation`, existing feature-setting/repository patterns.

**Required tests:** two tenants/two locations; wrong provider/location/phone; disabled connection; duplicate phone; GHL callback for an unapproved connection; connection deactivation; legacy pilot compatibility.

**Migration requirement:** Likely additive connection-policy fields/table after inspecting current migration conventions and production data. Approval is required before schema work.

**Deployment risk:** Incorrect backfill could activate an unintended tenant. Ship all records disabled, validate exact association, then approve one connection.

**Acceptance criteria:** A second connection is configured without source hardcoding, shared environment allowlist edits, or manual D1 mutation; all unapproved connections remain denied.

## P0-3 — Edge/API launch baseline

**Evidence:** `src/config/app.ts` applies `cors({ origin: "*" })` globally; no reviewed Worker route has application rate-limit middleware.

**Impact/severity:** High. Authentication still protects tenant routes, but a customer-facing launch should not rely on wildcard browser exposure or unspecified edge limits.

**Minimal change:**

1. Inventory browser consumers and configure explicit allowed origins, methods, and headers for them; avoid CORS on webhook-only paths unless required.
2. Establish Cloudflare WAF/rate-limit controls for public webhooks and authenticated APIs, with provider-safe thresholds/exceptions.
3. Add only bounded application guards where edge policy cannot meet an endpoint’s requirement.
4. Preserve Meta/GHL signature checks; rate controls must not become authentication substitutes.

**Reuse:** Existing Hono app composition and Cloudflare configuration; do not add another auth layer.

**Required tests:** allowed and denied origins; preflight; webhook signature still evaluated; rate-limit response/retry behavior; no cross-tenant authorization change.

**Migration requirement:** None expected; deployment/config approval required.

**Deployment risk:** Misconfigured origin/rate policy can break provider webhooks or clients. Stage against known provider source behavior before production.

**Acceptance criteria:** Explicit documented origin policy and tested rate protections exist; no unauthenticated route gains wider capability.

## P0-4 — Operational visibility and recovery

**Evidence:** Durable events, delivery rows, DLQ and error codes exist, but no alert definitions/runbooks/counters were found. `UNKNOWN` deliveries intentionally remain ineligible for automatic replay.

**Impact/severity:** High. A safe no-retry rule requires timely operator discovery and a documented decision path.

**Minimal change:**

1. Add privacy-safe aggregate operational queries/metrics for credential expiry, active/failed/dead-letter events, unknown deliveries, queue age/DLQ, signature failures, and provider HTTP outcome classes.
2. Document owner, threshold, acknowledgement, escalation, and rollback process.
3. Add explicit manual investigation/reconciliation flow for `unknown` delivery; never make it a resend button.
4. Test recovery state transitions with current event/delivery repositories.

**Reuse:** `IntegrationEventRepository`, dead-letter repository, delivery tables, current safe transport classifications, Cloudflare observability.

**Required tests:** aggregate queries exclude payload/text/tokens; alert-class state generation; no unknown replay; stale lease and dead-letter visibility.

**Migration requirement:** Prefer no schema change initially; an additive metrics/audit index requires separate review if performance needs it.

**Deployment risk:** Observability must not log customer text or credentials.

**Acceptance criteria:** An assigned operator can identify and classify a failed/unknown send and a stalled queue without raw payload access.

## P1-1 — Redaction, retention, and support policy

**Evidence:** `handleError()` emits `ApiError.details`, while GHL client errors can retain parsed provider responses. Meta/GHL message text is intentionally persisted in canonical/event payload records. No retention or privacy policy was found.

**Impact/severity:** High for routine client use; scope depends on actual provider response content and applicable privacy obligations.

**Minimal change:** Create an allowlisted error serializer for external provider details; define WABA record retention, deletion/access handling, support access, audit ownership, and no-log tests. Do not delete historical records without approved policy.

**Reuse:** `logger`, `ApiError`, existing safe GHL/Meta diagnostics, tenant-scoped repositories.

**Required tests:** nested provider error redaction; response/log redaction; tenant-scoped retention candidate query; customer text does not appear in operational diagnostics.

**Migration requirement:** Policy first. Any retention scheduling/data deletion requires separate production approval.

**Acceptance criteria:** Public responses and operational logs contain only allowlisted diagnostics; privacy/support process is approved.

## P1-2 — Real-business onboarding contract

**Evidence:** Generic backend session/code-completion routes exist; no Embedded Signup user interface or client onboarding runbook is in this repository. The Graph provider validates scopes, WABA/phone access and invokes app subscription.

**Impact/severity:** Required before a client can onboard repeatably.

**Minimal change:** Document and implement only the approved client-side/operator acquisition of the Meta authorization code, then invoke existing Core state-bound endpoints. Define Meta business ownership, app access, phone eligibility/coexistence, webhook field subscription, token owner, app-review, quality/limit, and rollback prerequisites.

**Reuse:** Existing provision/session/complete endpoints and connection/credential lifecycle.

**Required tests:** authorization code belongs to tenant/operator state; denied WABA/phone/subscription; connection replacement; generic credential lifecycle tests from P0-1.

**Migration requirement:** None assumed.

**Deployment risk:** Meta-admin configuration is external and must be tested against current official documentation; do not make Core source guesses.

**Acceptance criteria:** One authorized business can complete onboarding without developer-test guards or manual D1 changes, and asset ownership/subscription is evidenced.

## P1-3 — Production messaging policy/features

**Evidence:** `webhook.ts` parses only text; `graph-outbound-transport.ts` sends only free-form text; `outbound.ts` enforces the 24-hour latest-inbound window. No template/media/interactive/opt-out/cost handling exists.

**Impact/severity:** Required before claiming broader WhatsApp coverage; not required for a strictly defined human text reply inside the service window.

**Minimal change:** Decide the first-client product contract. If out-of-window/proactive messaging is required, add approved template selection/validation and consent policy before enabling it. Add media/interactive handling only when a real requirement exists.

**Reuse:** canonical message model, Meta transport adapter, delivery repository, existing outbound idempotency.

**Required tests:** template outside-window; opt-out prevention; unsupported inbound event recorded/triaged; media size/type limits; delivery reconciliation.

**Migration requirement:** Depends on approved feature requirements; do not prebuild unused fields.

**Acceptance criteria:** Capability claims exactly match tested provider behavior and applicable Meta policies.

## P2 — Broader rollout and commercial operations

**Evidence:** No managed multi-tenant onboarding UI, usage quota/cost telemetry, automated quality/limit monitoring, or scale/concurrency load evidence exists.

**Minimal change:** After P0/P1, add tenant-level usage/cost aggregation, approved onboarding automation, provider capability inventory, load tests, and support ownership—not another messaging pipeline.

**Acceptance criteria:** Multiple independently approved tenants can be onboarded/deactivated without source hardcodes or shared-secret changes, with bounded operational cost and support visibility.

## Next smallest implementation milestone

**Implement P0-2: tenant-managed connection authorization.** P0-1 is locally complete; keep its fail-closed lifecycle checks in any later release candidate and do not broaden the one-tenant pilot through shared environment allowlists.

## Deployment order and stop conditions

1. Review and deploy P0-1 only with an inventory of active credential lifecycle metadata; retain outbound disabled until separately approved.
2. Complete P0-2 as a separately approved schema/configuration design; retain old gates during migration.
3. Approve/configure P0-3 edge policy outside source control and test in a controlled environment.
4. Add P0-4 visibility and runbooks before launch activation.
5. Perform external Meta/client prerequisite review, then a separate release-readiness audit.
6. Activate only one explicitly approved connection, with outbound disabled until a separately approved controlled test.

Stop immediately if credential ownership/lifetime cannot be verified, if an unknown delivery would require resend, if tenant policy is ambiguous, if provider ownership/webhook subscription is unverified, or if edge controls would alter existing webhook delivery without a controlled test.

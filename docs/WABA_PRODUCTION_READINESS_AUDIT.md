# WABA production readiness audit

**Date:** 2026-11-03
**Scope:** Repository, migrations, configuration, and focused test review only. No production API, D1, Meta, GHL, Queue, credential, or deployment operation was performed for this audit.

## Executive conclusion

The developer-test bidirectional path is verified for one narrowly constrained text-message pilot. It is **not ready to be treated as a reusable real-business integration** yet.

The verified pilot boundaries are intentionally restrictive: `src/integrations/messaging/gohighlevel/provider-outbound-meta.ts` fixes one tenant, GHL location, provider, Meta phone number, and recipient in source; `src/integrations/messaging/meta-whatsapp/gohighlevel-inbound-config.ts` permits exactly one tenant; and both flows are default-off environment gates. This was appropriate for the safety pilot, but blocks a second business by design.

P0-1 local implementation closes the production credential-lifetime bypass. `MetaWhatsAppCredentialVault.resolve()` now evaluates every Meta credential before Graph transport, applying a 60-second UTC skew margin. Expired, missing-expiry, disabled, revoked/invalid, and unverified non-expiring credentials fail closed. The regular authorization-code provider derives expiry from validated token-debug data or the token exchange; when neither proves an expiry, it stores an explicitly unverified lifecycle that outbound blocks. No production deployment was performed as part of this local implementation.

## P0-1 credential lifecycle implementation (local, not deployed)

The vault records lifecycle evidence in existing encrypted-credential JSON metadata; no schema migration is required. Supported decisions are `VALID_EXPIRING`, `VALID_VERIFIED_NON_EXPIRING`, `EXPIRED`, `REVOKED_OR_INVALID`, `MISSING_EXPIRY`, `UNVERIFIED_NON_EXPIRING`, `DISABLED`, `WRONG_TENANT`, and `WRONG_CONNECTION`. Tenant and connection mismatches remain ownership-constrained repository misses rather than being revealed across tenants.

`MetaWhatsAppOutboundService` validates active tenant-owned connection and conversation before reserving its durable delivery effect, then resolves the current credential version from the vault immediately before Graph dispatch. Credential preflight failures persist as a permanent failed delivery with a stable code; they do not invoke Graph or become `UNKNOWN`. Existing `UNKNOWN` transport outcomes remain ineligible for automatic replay.

Known-expiry credentials are accepted only outside the skew margin. A non-expiring credential requires `verified_non_expiring` lifecycle metadata plus `provider_token_debug_verified` evidence, which may be written only by an onboarding provider. The present Graph onboarding provider intentionally does not attest a non-expiring system-user token, so missing/zero expiry remains blocked pending an approved provider-specific verification contract. Graph HTTP 401 and numeric Meta error `190` classify as `META_CREDENTIAL_INVALID`; a 403 without `190` remains a provider HTTP failure rather than being assumed revoked.

Developer-test onboarding still requires a usable expiry and writes `developerTest: true` plus `lifecycle: expiring`; replacement uses the existing optimistic credential version and same connection. The Test 015 bare-fetch receiver correction remains unchanged.

P0-1 does not rotate tokens automatically. Production outbound remains disabled for this release preparation, and no production credential change is required to deploy the fail-closed code while outbound remains off. Production onboarding of a non-expiring system-user credential remains a separate capability until an approved provider verification contract can emit trustworthy lifecycle evidence.

## Evidence boundary and verified developer-test baseline

The following Test 015 results are supplied operational evidence, not re-executed in this audit:

| Assertion | Evidence | Status |
| --- | --- | --- |
| GHL signed provider callback accepted | Test 015 operational record | Production-verified for pilot |
| Meta Graph accepted one text send and returned a `wamid` | Test 015 operational record | Production-verified for pilot |
| `sent` and `delivered` status callbacks were processed | Test 015 operational record | Production-verified for pilot |
| Recipient received one message | Independent operator confirmation | Production-verified for pilot |
| No duplicate send observed | One delivery reservation/effect key for the test | Production-verified for pilot |
| Safe inbound-only Worker restored | User-provided safe version `67c98d55-2131-4851-bb44-a4221d7256f9` | Reported; not remotely rechecked here |

The expected safe flags are `GHL_META_WHATSAPP_OUTBOUND_ENABLED=false`, `META_WHATSAPP_GHL_INBOUND_ENABLED=true`, `META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED=false`, and `NEW_QUEUE_ENVELOPES_ENABLED=false`. The source configuration has default-off checks; the live values above are operational input to this audit, not independently queried.

## Existing architecture inventory

| Concern | Existing component | Evidence |
| --- | --- | --- |
| Meta connection ownership | `MetaWhatsAppConnectionRepository` | Tenant-scoped queries; global phone-number uniqueness; joins to `integrations` in `src/integrations/messaging/meta-whatsapp/persistence/connection-repository.ts` |
| Credential storage | `MetaWhatsAppCredentialVault` + repository | AES-256-GCM with tenant/integration/connection/provider authenticated data in `src/core/security/encrypted-credential.ts`; ownership-constrained queries in the Meta credential repository |
| Onboarding state | `OAuthAuthorizationStateRepository` | Hashed, single-use, 10-minute, tenant/integration/operator-bound state in `src/integrations/messaging/meta-whatsapp/onboarding.ts` |
| Inbound Meta edge | `metaWhatsAppWebhookController` | HMAC validation over raw body, durable event acceptance, active-phone lookup, queue-dispatch fencing |
| Canonical persistence | `MessagingConversationRepository` | Tenant-scoped conversations/messages and inbound message uniqueness |
| Durable event processing | `IntegrationEventService` + `IntegrationEventRepository` | Tenant-scoped IDs, idempotent acceptance, leases, retry/dead-letter states |
| GHL publishing | `publishGHLCustomInboundForTenant()` | GHL OAuth context, tenant provider ID resolution, allowlisted diagnostics |
| GHL staff reply bridge | `provider-outbound.ts` + `provider-outbound-meta.ts` | Raw-body Ed25519 verification, durable source event, pilot identity checks, Meta outbound service |
| Outbound effect fencing | `MetaWhatsAppOutboundService` | Delivery reservation keyed by tenant/event/effect key, message hash conflict check, unknown outcomes are not replayed |
| Delivery reconciliation | `reconcileMetaWhatsAppStatus()` | Tenant/connection/provider-message scoped sent/delivered/read/failed update |
| Worker runtime | `src/index.ts`, `wrangler.jsonc` | Cloudflare Worker, D1, Queue producer/consumer and DLQ configuration |

Schema support was reviewed in migrations `0029` through `0035`, `0008`, `0010`, and `0023`. There is no `docs/MIGRATIONS.md` in the repository.

## Security readiness matrix

`IMPLEMENTED` means source and focused tests establish the control. It does not mean an external provider or live deployment was independently revalidated here.

| Control | Status | Evidence and limitation |
| --- | --- | --- |
| Meta HMAC webhook signature | IMPLEMENTED | `verifyMetaSignature()` requires `sha256=` HMAC-SHA-256 and compares the raw body in constant-time style; `webhook.test.ts` covers valid, altered, and absent signatures. |
| GHL Ed25519 callback signature | IMPLEMENTED | `verifyGHLSignature()` validates `X-GHL-Signature` over the raw body before provider-outbound parsing. Focused provider-outbound tests cover invalid signatures. Public-key currency must be checked with GHL before launch. |
| Meta webhook replay protection | IMPLEMENTED | `IntegrationEventService.accept()` creates tenant/provider/external-event identity; duplicate webhook tests prove one durable event/queue publication. |
| GHL provider-outbound replay protection | IMPLEMENTED | Provider source `messageId` is durably accepted before delivery; duplicate test fixtures prove only one effect. |
| Canonical message deduplication | IMPLEMENTED | `messaging_messages` is unique by tenant/provider/external message; inbound test proves one conversation/message after repeated processing. |
| Tenant isolation on Meta connection/credential | IMPLEMENTED | Repository predicates, SQL triggers in migration `0030`, phone uniqueness, authenticated encryption context, and cross-tenant tests. |
| Tenant isolation on GHL-to-Meta pilot | IMPLEMENTED for the pilot | Tenant/location/provider/recipient are server-owned guards. This is not yet a configurable multi-tenant policy. |
| Credential encryption / key versions | IMPLEMENTED | AES-256-GCM with 32-byte keyring validation, random 96-bit nonce, AAD binding, `key_version`, optimistic credential versioning, and revoke clears ciphertext/nonce. |
| Credential key rotation | PARTIAL | The vault can decrypt by stored version and encrypt new/replaced credentials with the active version. No bulk re-encryption, rotation runbook, retirement safety check, or rotation telemetry was found. |
| API-client authorization | IMPLEMENTED | Authentication resolves client identity from the bearer credential; permission middleware verifies client/principal/tenant consistency and active tenant status. |
| Wildcard API clients | PARTIAL / high risk | `*` is honored by `permits()` for legacy clients. The permission tooling prevents new wildcard grants but supports explicit revocation. The previously identified production wildcard clients still need an approved least-privilege migration; this audit did not query D1. |
| CORS | PARTIAL / high risk | `src/config/app.ts` applies `origin: "*"` to all routes, including authenticated APIs. Browser policy does not replace authentication, but this is not an origin allowlist appropriate for a client-facing production launch. |
| Application rate limiting | MISSING | No rate-limit middleware or route-specific throttling was found in the reviewed Worker paths. Provider HTTP `429` is classified for retry, which is not inbound abuse protection. Cloudflare edge controls are unverified. |
| Secret/PII logging | PARTIAL | Meta transport and custom-provider diagnostics intentionally allowlist statuses/codes. However `handleError()` logs and returns `ApiError.details`; GHL client errors retain parsed upstream bodies as `ApiError.details`. Broader redaction cannot be claimed. Canonical event/message tables intentionally retain message text; retention is not defined. |
| Operator/admin diagnostic controls | PARTIAL | Temporary diagnostics fail closed behind dedicated flags and fixed identifiers, but they are source-resident temporary routes without a documented approval, expiry, removal, or audit workflow. |
| Developer-test controls | IMPLEMENTED for the test asset | Four exact guard values are required; the feature is default-off and the credential is expiry-checked only when marked developer-test. |
| Default-off activation | IMPLEMENTED | Inbound forwarding, GHL custom provider, outbound pilot, developer test onboarding, and operator diagnostic use explicit `"true"` gates. |
| Cross-tenant contact/conversation isolation | IMPLEMENTED for tested paths | Meta persistence verifies active tenant connection; repository reads require tenant IDs; GHL bridge verifies resolved contact and canonical participant. Broader multi-tenant GHL production evidence remains unverified. |

### Security blockers

1. **P0 — add an approved edge/API protection policy before exposing a real client.** Replace global wildcard CORS with explicit allowed origins for browser surfaces (or omit CORS where not needed), and establish Cloudflare WAF/rate-limit rules plus route limits for public webhooks and authenticated APIs. Validate webhook-provider allowance without allowing generic abuse.
2. **P0 — remove production reliance on wildcard clients.** Inventory each existing client through the existing permission service, establish its exact scopes, migrate one tenant at a time with explicit rollback scopes, and leave no `*` grant in the first client’s production path.
3. **P1 — centralize safe error serialization.** `ApiError.details` must be bounded/redacted before logging or returning it. Preserve the already-safe Meta/GHL publisher diagnostics.
4. **P1 — formalize diagnostic lifecycle.** A temporary route requires an owner, enablement change record, expiry, removal commit, and a deployment that removes it after its purpose is complete.

## Meta production-onboarding readiness

### What the Core already supports

The generic route group supports a tenant-owned integration record, state creation, authorization-code completion, WABA access check, phone membership check, app subscription operation, connection ownership, encrypted credential creation/replacement, and connection activation:

* `POST /integrations/meta-whatsapp/provision` is idempotent and derives the tenant from authenticated context.
* `POST /integrations/meta-whatsapp/onboarding/sessions` creates state bound to authenticated tenant, integration, and operator.
* `POST /integrations/meta-whatsapp/onboarding/complete` accepts a code and calls the Graph onboarding provider.
* `MetaWhatsAppGraphOnboardingProvider` checks token app ID and the two required scopes, then validates WABA access and phone membership.

The developer-test completion endpoint is explicitly separate, exact-asset gated, and must not be generalized for client onboarding.

### Gaps and external prerequisites

| Area | Readiness | Evidence / required action |
| --- | --- | --- |
| Real-business authorization UX | PARTIAL | Backend accepts the authorization code but this repository has no hosted Embedded Signup client/UI or code-acquisition workflow. Use an approved client/operator surface that obtains a legitimate code; do not substitute a test-token import. |
| WABA and phone ownership | PARTIAL | Core validates access/phone membership after a code is supplied. Business ownership, verification, number eligibility, existing-number migration/coexistence, and account quality are Meta-admin prerequisites not verifiable from source. |
| App subscription | PARTIAL | `verifyWebhookSubscription()` issues `POST /{waba}/subscribed_apps`; it is an onboarding mutation rather than a read-only inspection. Treat it as an explicit idempotent onboarding step and verify the final subscription in Meta before launch. |
| Production token lifetime | P0 GAP | Generic completion may store no expiry and vault resolution only blocks expired `developerTest` credentials. Introduce a generic expiry contract, configurable renewal/replacement procedure, pre-send rejection on known expiry, and alerting before expiration. |
| System-user / business token strategy | MISSING | No source distinction or documented policy exists for temporary user, system-user, or business-integration token types. Select Meta-supported token ownership/lifetime for each real client before onboarding. |
| Credential replacement | IMPLEMENTED | Active credential replacement is optimistic-versioned and reuses the owned connection. It needs the production lifecycle guard above. |
| Webhook endpoint registration | PARTIAL | GET verification and POST HMAC validation exist. Meta app callback URL, subscribed `messages` field, app mode, and live-asset delivery were not queried and require an operator checklist. |
| Production/developer-test segregation | PARTIAL | Developer test is hard gated and metadata-marked, but the production connection model does not persist a formal connection environment/type or enforce different launch policy. |
| Templates / out-of-window compliance | MISSING | Only free-form text within a 24-hour customer-service window exists. No template creation, approval, send, category, pricing, or opt-in controls were found. |

### Current official documentation dependency

Meta configuration and policy change independently of this repository. The following official material must be checked by the launch owner immediately before onboarding: [WhatsApp Business developer hub](https://whatsappbusiness.com/developers/developer-hub/), [Embedded Signup default flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow), and [Cloud API overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview). Direct documentation retrieval was rate-limited/inaccessible during this audit, so this document intentionally does not assert current Meta eligibility, pricing, quality, or app-review rules as fact.

## Messaging reliability assessment

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Inbound acknowledgement after durable acceptance | IMPLEMENTED | Meta controller creates the durable event before the success response. Queue publication failure returns `503`; duplicate delivery can recover dispatch fencing. |
| Canonical inbound persistence | IMPLEMENTED | Queue handler leases event work then upserts a tenant-bound conversation/message. Duplicate processing is idempotent. |
| GHL inbox publication durability | PARTIAL | Canonical Meta message persists before GHL publishing; transient GHL failures retry through event processing. An ambiguous GHL publish is deliberately terminal to avoid duplicate inbox messages. There is no external GHL reconciliation mechanism. |
| Provider-outbound durability | IMPLEMENTED for pilot | Signed callback is accepted as an integration event before Meta send. Event claims use leases and explicit state transitions. |
| Meta send effect fencing | IMPLEMENTED | One delivery is reserved with tenant/event/effect key and message hash. Concurrent/duplicate callbacks do not send twice. |
| UNKNOWN send safety | IMPLEMENTED | Unknown send state is not automatically retried; only explicitly failed `provider_http_429`/5xx outcomes may retry. This rule must remain unchanged. |
| Meta delivery reconciliation | IMPLEMENTED | Webhook `sent`, `delivered`, `read`, and `failed` updates are matched by tenant, connection, and provider message ID; lower-ranked states do not downgrade higher-ranked states. |
| Transport timeout | PARTIAL | Failure categories include `aborted`, but Graph outbound `fetch()` does not attach an `AbortSignal` or explicit timeout. Runtime/network failure is persisted as unknown, safely not replayed, but bounded send latency is not implemented. |
| Retry and dead letter | IMPLEMENTED / PARTIAL | Integration events have lease, bounded retry, dead-letter persistence, and explicit operator replay for supported GHL event types. Meta events are not in the current general replay allowlist; define an operator-safe Meta recovery policy rather than enabling generic replay. |
| Queue backpressure | PARTIAL | Worker queue has max batch 1, max retries 10, DLQ and retry delay in `wrangler.jsonc`. Queue pause/backlog/age monitoring and runbooks are not present in code/configuration. |
| Status recovery after outage | PARTIAL | Late Meta status webhooks reconcile an existing delivery. No periodic provider-status reconciliation or missing-receipt alert was found. |
| Correlation | IMPLEMENTED for pilot | GHL source ID → integration event/effect key → delivery ID → Meta `wamid` is stored. GHL inbox publication uses Meta ID as `altId`. |
| Ordering / concurrency | PARTIAL | Leases and unique constraints prevent duplicate effects. No per-conversation ordering policy exists; concurrent distinct inbound events may process independently. |
| Alerting | MISSING | Source has structured logs and persisted state, not alert thresholds/dashboards/escalation for unknown sends, expiry, DLQ, queue age, or callback signature failures. |

## Feature readiness

| Feature | Implemented | Tested | Production-verified | Notes |
| --- | --- | --- | --- | --- |
| Meta inbound text | Yes | Yes | Pilot only | Parser intentionally accepts text only. |
| GHL inbox publish for Meta inbound text | Yes | Yes | Pilot only | Exact tenant/location gate; canonical write is before publish. |
| GHL staff reply to Meta text | Yes | Yes | Pilot only | Test 015 verified one recipient inside the 24-hour window. |
| Meta delivery sent/delivered/read/failed status | Yes | Yes | Sent/delivered only | Read was not evidenced in Test 015. |
| Attachments / media | No | No | No | Meta parser discards non-text; no media transport or storage contract. |
| Templates / outside-24-hour messaging | No | No | No | Text is blocked if latest eligible inbound is older than 24 hours. |
| Interactive messages | No | No | No | Text-only outbound body. |
| Unsupported-message handling | Partial | Partial | No | Non-text Meta inputs are ignored rather than durably represented/triaged. |
| AI/NUVI auto-replies | Guarded | Existing AI paths exist | Not part of pilot | The Meta bridge does not invoke AI/NUVI; keep that separation for launch. |
| Human handoff | Partial | Existing platform capability | Pilot via GHL agent reply | No WABA-specific handoff/assignment policy was found. |
| Opt-in / opt-out | No | No | No | Required policy/data handling is absent. |
| Template category/pricing telemetry | No | No | No | Do not infer cost from repository data. |

## Tenant scalability assessment

The durable data model is broadly reusable: `integrations`, `meta_whatsapp_connections`, `meta_whatsapp_credentials`, `messaging_connections`, canonical conversations/messages, and delivery rows are tenant scoped. A second account can technically have its own connection because the schema allows multiple phone numbers/WABAs per tenant and globally rejects reuse of the same phone number.

The actual active bridge is not scalable yet:

* Meta-to-GHL forwarding accepts one singular allowlisted tenant through environment variables.
* GHL custom provider configuration accepts one singular location.
* GHL-to-Meta outbound hardcodes the pilot tenant, location, provider, Meta phone ID, and recipient in `provider-outbound-meta.ts`.
* Developer-test onboarding hardcodes a separate exact asset tuple by environment guard.
* Shared environment variables and a deployment are currently required to activate a tenant.

### Minimum migration path (do not remove the pilot gates first)

1. Keep current pilot gates and Test 015 behavior unchanged.
2. Add a tenant-owned, reviewed connection capability record using the existing integration/connection repositories—not a new messaging service—that stores whether inbound publishing and human outbound are approved for that connection, the associated authorized GHL location/provider, and allowed sender policy.
3. Resolve those values through tenant/connection ownership at runtime; retain a global default-off master kill switch.
4. Replace source constants only after migration/backfill validation proves an exact single connection policy for the existing pilot.
5. Add cross-tenant, multiple-active-connection, duplicate-phone, disabled-connection, and rollback tests. Deploy with every new tenant disabled until its explicit approval is recorded.

This is a scoped authorization/configuration evolution, not a second messaging architecture.

## Operational and commercial readiness

| Area | Status | Evidence / gap |
| --- | --- | --- |
| Worker/D1/Queue basic configuration | PARTIAL | `wrangler.jsonc` defines D1, Queue consumer/DLQ, AI and Vectorize. Runtime cost counters/alerts are absent. |
| Message usage counters | MISSING | Delivery rows support later aggregation but no usage/tenant quota reporting implementation was found. |
| Meta/GHL costs | UNKNOWN | No price catalog or telemetry in source. Verify contract, template category, geography, and current Meta/GHL terms externally; do not hardcode prices. |
| Audit trail | PARTIAL | Durable events, deliveries, credentials metadata/version and logs exist; no defined retention schedule or immutable operator action audit was found. |
| Health reporting | PARTIAL | `/health` is a basic 200 route; it does not verify D1, Queue, Meta, GHL, credential age, or event backlog. |
| Incident response / rollback | PARTIAL | Prior pilot used a temporary rollback controller and safe Worker restore. There is no committed operational runbook, alert trigger, or routinely tested rollback process in this repository. |
| Tenant suspension / disconnection | PARTIAL | Connection disable/revoke primitives exist, but no documented suspension playbook or bulk tenant feature shutdown was found. |
| Privacy/retention | MISSING | Message text and event payloads are persisted. There is no WABA-specific retention, deletion, access, consent, or DPA policy in reviewed source/docs. |
| Client onboarding/support ownership | MISSING | No client launch checklist, RACI, support runbook, or consent/incident ownership document was found. |

## Single-location real-business launch checklist

All items are required before any production customer message is enabled.

- [ ] Approve and complete P0 items in the roadmap.
- [ ] Confirm Meta app mode/app review/business verification, WABA/phone ownership, phone eligibility or coexistence, webhook callback, subscribed fields, account quality, limits, and approved token ownership through current official Meta guidance.
- [ ] Implement generic production token expiry metadata, pre-send expiry fail-closed behavior, renewal ownership, and alerting.
- [ ] Use the existing state-bound production authorization-code route; do not use developer-test token onboarding for a client asset.
- [ ] Replace source-hardcoded pilot identities with a tenant-owned approved connection policy, retaining a global kill switch and disabled-by-default connection behavior.
- [ ] Replace wildcard CORS with explicit origin policy and configure/test edge plus application-level rate limits.
- [ ] Migrate the client’s API client off wildcard permission using existing permission/grant tooling and a tenant-scoped rollback grant set.
- [ ] Establish operator dashboard/alerts/runbooks for credential expiry, unknown delivery, dead letters, Queue age/DLQ, signature failures, and external-provider degradation.
- [ ] Decide and implement consent/opt-out, privacy retention/deletion, data-access, support escalation, and incident ownership policy.
- [ ] Limit the first launch to exactly the implemented contract: authorized human text reply inside an open 24-hour window. Keep media, templates, campaigns, AI replies, and arbitrary recipients disabled.
- [ ] Run a separately approved controlled launch/recovery test and document its evidence without customer content or secrets.

## Explicit no-go criteria

Do not activate a real-business WABA when any of the following is true:

1. The client is using the developer-test flow, a temporary untracked token, a wildcard client permission, or a shared tenant credential.
2. Production credential expiry is unknown, expired, or not fail-closed for the intended connection.
3. Meta ownership/subscription/webhook/app access and required permissions are not externally verified for that asset.
4. Tenant/location/provider/recipient policy remains hardcoded for a different pilot or cannot be proven from tenant-owned configuration.
5. CORS and rate-limit controls are not approved/tested.
6. An `unknown` delivery would need automatic replay to proceed.
7. Queue/DLQ, dead-letter, token-expiry, and external-provider failure cannot be observed and acted on by an assigned owner.
8. Required opt-in, template, privacy, retention, or commercial terms have not been decided for the claimed product scope.

## Audit limitations

This audit did not inspect live Meta app settings, Meta Business ownership, Graph permissions, GHL Marketplace/provider ownership, Cloudflare WAF/logs, production D1 contents, queue metrics, deployment configuration, secret values, or customer data. Those are operational gates, not source-code facts.

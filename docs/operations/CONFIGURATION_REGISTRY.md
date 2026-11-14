# Production configuration registry

Current production status is recorded in the [production baseline](PRODUCTION_BASELINE.md). The version 465 and 466 observations below are historical and precede the promotion of version 467 with the Core keyring binding.

Metadata only. Verification date: 2026-11-14 UTC, active Worker version a54454ae-ad58-4c23-a9cd-51e1ab6aaec9 at 100%. Present means name/type observed, not a successful provider call or verified secret contents. Rows marked source-only have no production verification recorded. Secret values were never read. Never save raw Worker configuration output in Git.

| Name(s) | Owner / binding type | Requirement, format, dependencies and failure impact | Verification |
|---|---|---|---|
| CORE_CREDENTIAL_ENCRYPTION_KEYS | Core credential storage / secret | Required for encrypted reads/writes; JSON version-to-Base64 AES-256 keys. Missing blocks encrypted reads and refresh persistence. Verify name and approved custody labels. | Absent in active 465 and latest inactive 466 |
| CORE_CREDENTIAL_ACTIVE_KEY_VERSION | Core / text | Required with keyring; valid version label present in it. Missing or unknown label blocks cipher initialization. | Absent in active 465; `ghl-v1` in inactive 466 |
| CORE_CREDENTIAL_LEGACY_READS_ENABLED | Core / text | Temporary exact true only during approved bridge; otherwise fail closed on legacy fields. Check legacy counts and candidate flag. | Absent in active 465; `true` in inactive 466 |
| META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS, META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION | Meta / secret and text respectively | Required for Meta vault; separate JSON keyring and matching label. Missing blocks vault access; check metadata and Meta custody record. | Present |
| GHL_OAUTH_CLIENT_ID, GHL_OAUTH_CLIENT_SECRET, GHL_OAUTH_REDIRECT_URI, GHL_OAUTH_SCOPES | GHL / first two secrets, others text | Required for OAuth as applicable; provider credentials, exact callback HTTPS URI and approved scopes. Compare provider registration and binding names; absence breaks authorization or refresh. | Present |
| GHL_APP_SHARED_SECRET, GHL_API_KEY, GHL_LOCATION_ID | GHL / secrets | Feature-specific shared secret or legacy API credential/location pair. Verify intended consumer and scope; missing blocks dependent authentication or legacy CLI flow. | Present |
| FL360_API_KEY, JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE | Core auth / secrets | Surface-specific API credential and JWT signing/claim settings. Check issuer and audience compatibility without printing values; missing breaks dependent authentication. | Present |
| DB, CF_VERSION_METADATA | Platform / D1 and version metadata respectively | Production database identity and Worker version metadata; compare binding identities. Missing affects data access or attribution. | Present |
| AI, VECTORIZE, VECTORIZE_V2, GEMINI_API_KEY, AI_BOOKING_ENABLED, AI_PIPELINE_V2_TENANT_ALLOWLIST | AI / AI, Vectorize, secret and text as applicable | Feature-specific resources, credential, boolean and tenant list. Compare index identities and gates; missing affects retrieval or provider calls. | Resources, credential and booking gate present; pipeline list source-only |
| GHL_INBOUND_QUEUE, GHL_INBOUND_QUEUE_ENABLED, NEW_QUEUE_ENVELOPES_ENABLED | Messaging / Queue and text flags | Required for enabled Queue flow; compare producer, consumer, retry/DLQ and flags. Missing or drift affects dispatch. | Names present; consumer settings require independent comparison |
| CORS_ALLOWED_ORIGINS, APP_ENVIRONMENT | Core HTTP / text | Exact approved origins and production environment label; compare privately and test GET health and OPTIONS contacts. Drift can break clinic traffic or route isolation. | Clinic origin confirmed; health 200, contacts preflight 204 |
| META_WHATSAPP_APP_ID, META_WHATSAPP_APP_SECRET, META_WHATSAPP_VERIFY_TOKEN, META_WHATSAPP_GRAPH_API_VERSION | Meta / secret for app secret and verify token; text otherwise | Required for enabled provider operations; app identity, signing material, verification token and supported version. Check names and approved provider metadata; absence blocks verification or API access. | Present |
| META_WHATSAPP_GHL_INBOUND_ENABLED, META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST, GHL_META_WHATSAPP_OUTBOUND_ENABLED, GHL_CUSTOM_PROVIDER_ENABLED, GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST, MANUAL_REPLY_ENABLED | Messaging / flags and exact scope lists; custom provider pair stored as secrets | Feature-specific; preserve effective values and approved scope. Wrong values may block routing or activate sending. Compare privately. | All except MANUAL_REPLY_ENABLED observed; latter source-only |

## Production source and inactive candidate attestation (2026-11-14)

- Active deployment `dce73f0b-7bd0-489c-a258-76c5f4ae0676` routes 100% to version `a54454ae-ad58-4c23-a9cd-51e1ab6aaec9` (version 465). Its Cloudflare version script ETag is `5ab28638623586aa156c9cd5a5872f4dd412a70eb280f4b7e591e3e36aaf8715`.
- Read-only Cloudflare `GET` retrieved the script-content multipart response. That endpoint is script-level, not version-addressed; its response ETag matched the exact active version ETag (and also matches version 466). The privately retained artifact is in the ignored `.wrangler/production-source-recovery/a54454ae-ad58-4c23-a9cd-51e1ab6aaec9` directory with a current-user-only ACL. Raw response SHA-256: `f6b542a5ac1fff27200d8ecf9f753dc70905b06848b2b60cb421d83a2df4d5d7`; local artifact manifest SHA-256: `3bfa76c7f9becc60a33a265403005a84893d1fdd3346080c2ac28d90d03ece00`.
- Cloudflare's source map embeds 441 module contents, including 265 Core `src/` files. Of those, 264 match Git baseline `c703950c1ee9a3f46c9e999fc47bdcfcd5320e43` after line-ending normalization. The only difference is the CORS change in `src/config/app.ts` removing `/health` from the CORS exclusion. The Core credential storage and GHL credential runtime match the baseline. Cloudflare does not report a Git commit SHA; this is source-content parity evidence, not a Cloudflare commit identity or fresh-build byte-for-byte claim.
- CORS was live-checked: GET `/health` was 200; approved-origin OPTIONS `/contacts` was 204 and allowed POST, Authorization and Content-Type; an unapproved origin received no Access-Control-Allow-Origin. The active version's `CORS_ALLOWED_ORIGINS` binding contains the approved clinic origin.
- Latest inactive version is `ed38a5f9-8c8f-41db-b05d-f9604ae63a85` (version 466). It has the same script ETag as active version 465. Its metadata retains all 57 active binding descriptors and the existing 15 secret names; the two additional plain-text bindings are `CORE_CREDENTIAL_ACTIVE_KEY_VERSION=ghl-v1` and `CORE_CREDENTIAL_LEGACY_READS_ENABLED=true`. The Core keyring secret is absent. Secret payloads were not retrieved. This pre-existing inactive version is incomplete and is not approved for promotion.
- No Worker configuration was changed by this verification. The next safe operation requires explicit approval for key generation/KeePass custody, followed by separate approval for inactive secret staging. The active unkeyed version is not a safe rollback after any encrypted credential write.

Remaining feature settings are registered below by name. All are text in source unless documented otherwise. Optional unless their feature is approved and enabled. Use exact boolean strings for gates, approved scoped lists or exact identifiers/origins for allowlists and identity, and bounded numeric inputs for thresholds. A missing required companion can disable or reject the dependent feature; check source validation and compare effective values privately before release. Diagnostic phone configuration is sensitive even when stored as text.

- GHL_WHATSAPP_PAGE_PARENT_ORIGINS — source registered; production value not attested here.
- WABA_GHL_READONLY_ENABLED — source registered; production value not attested here.
- WABA_GHL_READONLY_TENANT_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_LOCATION_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_USER_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_COMPANY_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_APP_ID — source registered; production value not attested here.
- WABA_GHL_CONTEXT_VERIFY_ENABLED — source registered; production value not attested here.
- WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_ENABLED — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_TENANT_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_LOCATION_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_USER_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_COMPANY_ALLOWLIST — source registered; production value not attested here.
- WABA_GHL_READONLY_PREVIEW_APP_ID — source registered; production value not attested here.
- WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED — source registered; production value not attested here.
- WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST — source registered; production value not attested here.
- WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST — source registered; production value not attested here.
- META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST — source registered; production value not attested here.
- GHL_OPERATOR_CONTACT_DIAGNOSTIC_ENABLED — source registered; production value not attested here.
- GHL_OPERATOR_CONTACT_DIAGNOSTIC_TENANT_ALLOWLIST — source registered; production value not attested here.
- GHL_OPERATOR_CONTACT_DIAGNOSTIC_LOCATION_ALLOWLIST — source registered; production value not attested here.
- GHL_OPERATOR_CONTACT_DIAGNOSTIC_PHONE_E164 — source registered; production value not attested here.
- GHL_OPERATOR_PROVIDER_INSPECTION_ENABLED — source registered; production value not attested here.
- META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED — source registered; production value not attested here.
- WABA_OPS_ALERTS_ENABLED — source registered; production value not attested here.
- WABA_OPS_BACKLOG_THRESHOLD — source registered; production value not attested here.
- WABA_OPS_FAILURE_THRESHOLD — source registered; production value not attested here.
- WABA_OPS_DEAD_LETTER_THRESHOLD — source registered; production value not attested here.
- WABA_OPS_CREDENTIAL_EXPIRY_THRESHOLD — source registered; production value not attested here.
- WABA_OPS_CORRELATION_FAILURE_THRESHOLD — source registered; production value not attested here.
- CORE_DIAGNOSTICS_LEVEL — source registered; production value not attested here.
- META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED — source registered; production value not attested here.
- META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST — source registered; production value not attested here.
- META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST — source registered; production value not attested here.
- META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST — source registered; production value not attested here.

Core key custody: proposed label ghl-v1, proposed KeePass entry FusionLab360 Core / GHL credential keyring (production). Provisioning and rotation not started. No historical Core version was required by the observed live GHL fields. Any future ciphertext and backup require their original version and rollback readers must retain it. Meta custody/version and rotation history are unverified here; do not share domains.

Offline release check: run node scripts/ghl-credential-release-preflight.mjs baseline.json candidate.json manifest.json with protected Wrangler versions view --json snapshots and an approved manifest containing baselineId, candidateId, keyVersion, approvedKeyVersions and requiredReadVersions. The latter comes from read-only ciphertext inventory; use an empty array only if verified empty. Secret-name presence cannot prove secret material or inheritance. Record active traffic and separately compare service settings, including routes, cron and Queue consumer/DLQ, before promotion.

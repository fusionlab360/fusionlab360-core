# FL360 Core Production Gap Closure

Verified 2026-11-09. This is a local release plan for the canonical branch `integration/fl360-core-consolidated`; it is not deployment authorization.

## Local implementation

- GHL location tokens in `integration_credentials.api_key` and `refresh_token`, and GHL company tokens in `oauth_installations.access_token` and `refresh_token`, use the existing AES-GCM credential cipher. The stored `fl360enc:v1:<key-version>:<nonce>:<ciphertext>` envelope identifies the key version. Associated data binds location credentials to tenant/provider/location/field and company installations to provider/account type/company/field.
- OAuth refresh-lock columns and compare-and-set updates are retained. Missing key configuration stops GHL credential writes. Plaintext reads require `CORE_CREDENTIAL_LEGACY_READS_ENABLED=true`; metadata-only reads do not decrypt tokens.
- The manual `migratePlaintextBatch()` repository methods process at most 200 GHL rows per call, skip already encrypted fields, compare old values before update, and can be safely resumed. They cover both credential tables, including legacy PIT values in `integration_credentials`. There is no schema change and no automatic invocation. A production executor is not included in this candidate.
- GHL inbound and provider-outbound webhooks use the existing bounded reader with a 10 MiB limit before buffering. Oversized requests return 413. Signature validation receives the exact raw bytes before JSON processing.
- `ApiError` responses and logs expose only a safe message, allowlisted code, status, and generated correlation ID. `details` and exception messages are not serialized.
- General browser CORS allows only exact configured HTTPS origins (plus localhost HTTP for local development). Missing, wildcard, malformed, and `null` origins fail closed. Webhooks remain server-to-server. The GHL embedded page keeps its existing page-parent and verifier-specific origin checks.

## Read-only production evidence

Collected with Wrangler and D1 metadata queries only. No secret values, credentials, or Queue payloads were read.

| Area | Observed state |
|---|---|
| Worker | `fusionlab360-core`, active version `b6d6c87d-1232-46b4-b33d-7cd0e3de0f49`, 100% traffic, deployment `cdb5cc7b-de96-4821-9bea-ce3dfdaabdf7`, created 2026-11-05 13:40:07 UTC. |
| Uploaded inactive versions | `385e660c-6efc-4085-9ebe-8d7ac7e1fc7d` (integrated WABA candidate) and `6d24ac5b-263a-47ef-a649-d9f6b2ca5e3d` (consolidated candidate) are distinct from this local source. |
| D1 | `fusionlab360-db`, database ID `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`. The migration ledger has no 0042, 0045, or 0046 entries. `meta_whatsapp_connections` has the pre-0042 shape; the 0042 activation audit and 0045 legacy approval tables are absent. `messaging_outbound_deliveries.retry_after_at` is absent. |
| Queues | `fusionlab360-ghl-inbound` exists with one producer and one consumer; `fusionlab360-ghl-dlq` exists with no producer or consumer. Wrangler did not return queue depth/backlog metrics. No message payloads were inspected. |
| Visible flags | `GHL_INBOUND_QUEUE_ENABLED=true`; `NEW_QUEUE_ENVELOPES_ENABLED=false`; `META_WHATSAPP_GHL_INBOUND_ENABLED=true`; `GHL_META_WHATSAPP_OUTBOUND_ENABLED=false`; `WABA_GHL_READONLY_ENABLED=false`; operator diagnostics are off. `META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED=true` remains enabled with its configured allowlists; the allowlist values were not copied into this document. |
| Credential key bindings | Secret-name metadata contains `META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS` but no `CORE_CREDENTIAL_ENCRYPTION_KEYS`. No Core key-version or legacy-read binding was visible on the active version. Secret values were not retrieved. |

The source code for the deployed `b6d6c87d` Worker was not obtained in these read-only checks. Its behavior against each future schema state therefore still requires an artifact-level compatibility review before migration. Locally, the current Core suite covers pre-0042 and revised/original 0042 compatibility paths.

## Forward-only schema plan

Production is confirmed pre-0042. The migration sequence is:

1. `0042_meta_whatsapp_connection_activation.sql` once. It adds lifecycle fields, binding indexes, and append-only activation audit behavior. Keep lifecycle enforcement off.
2. `0045_meta_whatsapp_legacy_review.sql`. It requires the 0042 lifecycle columns and audit table, checks prerequisites before DDL, and creates no approvals. Do not run it before 0042.
3. `0046_meta_whatsapp_outbound_retry_cooldown.sql`. It adds nullable `retry_after_at`; it is additive and independent, but remains third in the release sequence.

Never replay 0042 if a future ledger check says it is already applied. For production's current ledger and physical schema, apply the sequence above. No SQL migration is needed for credential ciphertext; the batch methods update existing TEXT fields conditionally.

Compatibility evidence: the local pre-0042 WABA inbound/Queue test passes with lifecycle enforcement off; original and revised 0042 shapes and the 0045 prerequisite path are covered by migration and route fixtures. 0045 does not rewrite connection state or grant approval. 0046 is nullable/additive. Compatibility of the unavailable deployed Worker artifact remains an explicit pre-migration gate.

Queue envelope rollout remains off. Preserve existing inbound processing and allow both currently supported envelope formats until aggregate backlog is observed drained; Wrangler's current queue metadata does not provide the required depth. Do not inspect message bodies to estimate the backlog.

## Controlled release sequence (not executed)

### Preconditions

- Verify the exact local source commit, branch, manifest, Worker config, and remote active version immediately before the release.
- Obtain an owner-approved exact browser-origin list. No production `CORS_ALLOWED_ORIGINS` values are invented here. Same-origin requests, server-to-server calls without `Origin`, webhooks, and the GHL page's own verifier CORS path retain their existing behavior.
- Generate a new random 32-byte AES-256 key outside D1 and source control. Stage `CORE_CREDENTIAL_ENCRYPTION_KEYS` as a secret keyring such as `{"v1":"<base64-key>"}`; configure `CORE_CREDENTIAL_ACTIVE_KEY_VERSION=v1` and temporarily `CORE_CREDENTIAL_LEGACY_READS_ENABLED=true`. Keep the previous key in the keyring during rotation. Do not reuse the Meta keyring.
- Add a reviewed, one-off production migration executor before attempting data conversion. This candidate supplies and tests the bounded CAS batch methods but intentionally exposes no production route or CLI command for invoking them.
- Review the deployed old Worker source against 0042/0045/0046 and obtain queue backlog depth through approved aggregate-only tooling. Stop if the code compatibility check or backlog check is unavailable.
- Confirm the production D1 is on the Time Travel-capable backend. Immediately before the first D1 write, run `wrangler d1 time-travel info fusionlab360-db` and record its timestamp/bookmark. Do not export D1 because exports would contain credentials. Cloudflare describes Time Travel as automatic, and `restore` overwrites the database in place; a restore needs separate approval and is not the default application rollback. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

### First production operation requiring approval

The first production write would be an **inactive version upload of this exact commit with its reviewed bindings and the encryption key supplied through an approved ephemeral secrets file**, for example `wrangler versions upload --secrets-file <secure-temp-file>`. It creates a version without routing traffic. Verify the resulting version's binding names and source metadata before proceeding. Do not use `wrangler secret put`: Cloudflare documents that command as creating and immediately deploying a new version. Do not patch `/versions/latest` while another inactive version may be the latest. See [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).

### Operations after separate approval

1. Record the D1 Time Travel bookmark and verify the selected Worker source, bindings, keys, CORS origins, and off-state feature gates.
2. Upload this commit as an inactive Worker version with the keyring and variables attached. Verify it does not receive traffic.
3. Apply 0042, then 0045, then 0046. Stop immediately on any prerequisite or ledger mismatch; do not retry a migration already recorded as applied.
4. Before promotion, verify from non-secret connection identifiers that the existing Meta phone-number connection maps only to the approved `gmmetro` tenant. Stop on a missing, duplicate, or cross-tenant mapping. Do not read credentials, message records, or Queue payloads for this check.
5. Promote the exact version to 100% with the new WABA/product gates still off. Avoid a mixed-version gradual deployment while old code may still write plaintext OAuth refresh results.
6. Verify health, the migration ledger, active version and traffic, visible gate values, and Queue/DLQ aggregate status without reading payloads. Preserve `GHL_INBOUND_QUEUE_ENABLED=true`, the current `gmmetro` inbound allowlist, `META_WHATSAPP_GHL_INBOUND_ENABLED=true`, and outbound-off state.
7. From the separately approved executor, call each `migratePlaintextBatch(50)` until it returns zero, record counts only, and resume after transient failures. Then verify legacy-row counts without selecting token values and set `CORE_CREDENTIAL_LEGACY_READS_ENABLED=false` in a later reviewed version. This data conversion is a separate production migration and is not part of the current approval.
8. Validate OAuth installation/refresh and webhook signatures in an approved nonproduction environment. Production smoke checks must not send WhatsApp messages or call live provider APIs unless separately approved.

### Stop and rollback

- If the inactive upload, schema precheck, binding review, health check, migration ledger, queue aggregate, or known-gate check fails, do not promote and stop subsequent writes.
- For an application fault after promotion, return traffic to the verified prior Worker `b6d6c87d-1232-46b4-b33d-7cd0e3de0f49` only after confirming its compatibility with the now-current D1 schema. Worker rollback does not revert D1 changes.
- Do not automatically restore D1. A Time Travel restore overwrites production state and can discard writes after the bookmark; require a separate owner approval and a recovery plan before using it. Prefer a forward repair for additive migrations.
- Leave WABA lifecycle enforcement, new Queue envelopes, dashboard/read-only surfaces, and Meta outbound off. Do not modify the existing WABA candidate versions or worktrees.

## Release decision

**BLOCKED.** Local implementation and tests pass, but production release is not ready: Core encryption keys are absent; an approved `CORS_ALLOWED_ORIGINS` list is not recorded; the production plaintext conversion executor is not packaged; queue depth is unavailable from current Wrangler metadata; and the deployed Worker source has not been compared against the proposed schemas. These are release prerequisites, not reasons to change production now.

No secret change, Worker upload/deployment, migration, D1 credential read/write, provider API call, WhatsApp message, feature flag change, Marketplace operation, or WABA candidate modification was performed.

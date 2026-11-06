# WABA P0-4 read-only production release package

## Candidate provenance and scope

This worktree starts at the verified P0-1 commit `9381fb84b1e1886467b0ff78c386fbc702d41453`. The four P0-1 reconciliation files were copied from the P0-1 release worktree and hash-verified before the P0-4 changes were applied. P0-2 lifecycle enforcement and migrations 0042/0043 are excluded. The existing production diagnostic route is retained. The original checkout and prior worktrees are not changed.

The dashboard is mounted at `GET /marketplace/gohighlevel/whatsapp-preview`; its data endpoint is `GET /marketplace/gohighlevel/whatsapp-preview/status`. Both are unavailable unless the environment-specific gate, one-value allowlists, shared secret, and exact HTTPS parent origin are configured. Production uses `WABA_GHL_READONLY_ENABLED`, explicitly `false` in this candidate. Preview uses its separate `WABA_GHL_READONLY_PREVIEW_*` variables. Preview allowlists are never used as production fallbacks.

## Status evidence and limits

The page reports only a tenant/location-scoped projection of existing Core records and Worker configuration:

- Connection row presence and stored state.
- Credential row presence, whether ciphertext/nonce/AES-GCM material is present (a boolean only), stored credential status, and expiry-metadata classification.
- Tenant's stored GHL provider identifier presence, global Custom Provider switch, and exact location gate.
- Meta inbound global switch and tenant allowlist separately.
- Meta outbound global switch.
- Operational provider and delivery verification explicitly remain “Not verified.”

The page does not unseal credentials, inspect plaintext OAuth tokens, call Meta or GHL, inspect customer/contact/message data, or mutate D1/Queues. Expiry metadata does not prove token validity; a configured provider identifier does not prove live registration; enabled flags do not prove message delivery. Effective inbound is shown unavailable when a required local record/configuration gate is missing, disabled when its feature/tenant gate is off, and otherwise “Not operationally verified.” Outbound remains disabled under current production config; if enabled later, this page still labels it unverified because recipient, window, transport, and delivery gates are not exercised here.

The database selectors use the pre-0042 schema: `meta_whatsapp_connections` (`id`, `tenant_id`, `integration_id`, `status`) and `meta_whatsapp_credentials` (`status`, a ciphertext-present boolean, `metadata`). GHL ownership is projected from the existing location OAuth record, tenant/integration ownership, and stored app/company/location metadata. The query returns no token or raw metadata columns. No migration is required.

## Production authentication

Production does not depend on Preview Cloudflare Access. The browser requests HighLevel `REQUEST_USER_DATA`, accepts one `REQUEST_USER_DATA_RESPONSE` only from `window.parent` and the configured exact HTTPS parent origin, then makes a same-origin GET with the encrypted context. The server decrypts it with `GHL_APP_SHARED_SECRET` and requires the exact allowlisted user, company, active location, admin role, live app status, and matching active tenant, OAuth installation, app/company/location ownership and enabled integration. All identifiers are fixed by server configuration; query parameters cannot select identity. The P0-4 candidate configures `GHL_WHATSAPP_PAGE_PARENT_ORIGINS=https://app.gohighlevel.com`, matching the previously working Preview handshake. HighLevel's User Context documentation specifies the `REQUEST_USER_DATA` exchange but does not define one canonical static parent origin; verify the actual production iframe origin before enabling the gate.

HighLevel's encrypted context does not document a first-use timestamp, nonce, or expiry. The page therefore discloses only the minimal read-only status projection and cannot authorize connection changes, credential operations, replays, or messages. The production `GHL_APP_SHARED_SECRET` is currently absent from the Worker secret inventory; therefore production context decryption has not been verified, and the production page must remain disabled until that secret is securely provisioned and the exact GHL iframe flow is reviewed.

## Production configuration comparison

Production version `e79c96c1-ef9a-4907-a469-27725058a8d0` was read-only verified at 100%, with health HTTP 200. Its known flags are inbound `true`, inbound tenant allowlist `gmmetro`, outbound `false`, operator diagnostic `false`, and new queue envelopes `false`. This candidate preserves those values and adds only the page parent-origin value and page gate `WABA_GHL_READONLY_ENABLED=false`. No production allowlists are set in this candidate. No migrations, bindings, routes for mutation, or traffic changes are included.

Existing production bindings observed: `DB` -> `fusionlab360-db` (`e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`), `GHL_INBOUND_QUEUE` -> `fusionlab360-ghl-inbound`, AI, `VECTORIZE` -> `fusionlab360-knowledge`, and `VECTORIZE_V2` -> `fusionlab360-knowledge-v2`. The candidate retains the baseline Wrangler D1, Queue, AI, Vectorize and version-metadata configuration. No queue behavior is changed by the page.

Existing production secret binding names (names only):

- `FL360_API_KEY`
- `GEMINI_API_KEY`
- `GHL_API_KEY`
- `GHL_CUSTOM_PROVIDER_ENABLED`
- `GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST`
- `GHL_LOCATION_ID`
- `GHL_OAUTH_CLIENT_ID`
- `GHL_OAUTH_CLIENT_SECRET`
- `JWT_AUDIENCE`
- `JWT_ISSUER`
- `JWT_SECRET`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS`
- `META_WHATSAPP_VERIFY_TOKEN`

`GHL_APP_SHARED_SECRET` is a required additional production secret and was not present. No secret values were retrieved.

## Versioned release and rollback procedure (future, separate approval)

The read-only `scripts/waba-p04-release-verify.ps1` checks a specified inactive
candidate against the expected active version, production D1/Queue/AI/Vectorize
binding identities, all baseline secret names, inbound-only flags, the page
gate OFF and health HTTP 200. Use `-RequireSharedSecret` for a P0-4 candidate
after the interactive secret stage. It prints only safe summary fields. Its
fixture mode requires `FL360_WABA_RELEASE_FIXTURE_MODE=1`. The updated
`scripts/waba-p04-release-verify.test.ps1` invokes the verifier with
`-RequireSharedSecret` and checks a missing `GHL_APP_SHARED_SECRET`; it has
9 local cases covering wrong versions, missing resources, unsafe flags and
failed health. The script
has not been run against Cloudflare; live provenance must still be checked
before every production-changing action.

The production secret must be the Shared Secret generated for Marketplace app `6aae88f014820909a78cd923`. HighLevel's documented backend flow decrypts its Custom Page user-context payload using `CryptoJS.AES.decrypt(encryptedUserData, sharedSecretKey)`, which matches this candidate's `GHL_APP_SHARED_SECRET` use. The value has not been inspected or copied. HighLevel also says to keep the secret server-side and use environment storage.

1. **Do not run `wrangler secret put`**: it immediately deploys a new Worker version. Use the versioned command only after the correct code version is uploaded.
2. As of the P0-4 release-preparation check, active production is version `e79c96c1-ef9a-4907-a469-27725058a8d0` (#450), but the newest uploaded remote version is `cac81ecc-5614-4a0e-9f4d-7ea3148d1904` (#451), tagged `fl360-waba-readonly-canary`. `wrangler versions secret put` patches the remote `/versions/latest` endpoint; run now would therefore base a secret-only version on that inactive canary, not on active production and not on the uncommitted P0-4 source. Do not run it in this state.
3. To make the secret-only version contain the current safe production code, first upload the exact verified P0-1 release source (not the P0-4 worktree) as a new inactive version. Use `--keep-vars`; inspect source parity, bindings, vars, secret names, and flags, and confirm this P0-1 version is now the newest remote version. Do not promote it.
4. With separate approval, stage the GHL secret onto that latest P0-1 version using Wrangler's masked interactive prompt (do not pass a value through an argument, environment variable, shell history, or logged file):

   ```powershell
   npx.cmd wrangler versions secret put GHL_APP_SHARED_SECRET --name fusionlab360-core --message "P0-4 GHL context secret staged; read-only gate off" --tag "fl360-p04-ghl-auth"
   ```

   This creates a new version without moving traffic. It uses the latest remote version's code, not local working-tree files. Record the returned version ID, verify its 15 secret names and all bindings/vars by name/value-safe metadata, and confirm production remains on `e79c96c1-ef9a-4907-a469-27725058a8d0` at 100%. Keep `WABA_GHL_READONLY_ENABLED=false`.
5. Then upload the P0-4 candidate as a separate inactive version with `--keep-vars`. Cloudflare documents that secrets omitted from a later version upload are preserved from the previous version; inspect the P0-4 version's secret names and bindings before promotion. If the Shared Secret name is absent, do not promote; after rechecking that P0-4 is the latest remote version, run `versions secret put` again so the secret-bearing version uses P0-4 code.
6. For the approved pilot, the exact allowlist values are:

   ```text
   WABA_GHL_READONLY_TENANT_ALLOWLIST=gmmetro
   WABA_GHL_READONLY_LOCATION_ALLOWLIST=Npx2IdDDRjXz2QW3Svx4
   WABA_GHL_READONLY_USER_ALLOWLIST=0pBHBAOAqx8eINEAsTXH
   WABA_GHL_READONLY_COMPANY_ALLOWLIST=iv9tiC7pYHDfqrXo0ZO6
   WABA_GHL_READONLY_APP_ID=6aae88f014820909a78cd923
   WABA_GHL_READONLY_ENABLED=false
   GHL_WHATSAPP_PAGE_PARENT_ORIGINS=https://app.gohighlevel.com
   ```

   Keep the gate false while promoting and verifying the code/secret version. Enabling the page requires a separate approved configuration version with all five allowlists, the verified parent origin and the gate set true; confirm a genuine GHL iframe request first. Do not use Preview Access as production authentication.
7. Promote only after separate explicit approval. Keep inbound enabled for `gmmetro`, outbound disabled, operator diagnostic disabled, new queue envelopes disabled and the page gate false. Verify 100% traffic, health HTTP 200, all expected flags/bindings, and inbound webhook/queue continuity. Do not send test messages or apply migrations.
8. If post-promotion checks fail, restore version `e79c96c1-ef9a-4907-a469-27725058a8d0` at 100% with `npx.cmd wrangler versions deploy --name fusionlab360-core --version-id e79c96c1-ef9a-4907-a469-27725058a8d0 --percentage 100 --yes`. Verify deployment status, health, inbound true and outbound false.

## Smoke-test checklist (after separate approval)

- With page gate false or missing, both page and status paths return 404.
- With gate on but missing any allowlist/secret, both paths fail closed.
- Genuine GHL iframe uses the configured exact parent origin and valid encrypted context; same-origin status GET succeeds only for the approved admin/user/location/company/app.
- Missing/malformed context, other user/location/company/app, tenant mapping mismatch, missing installation metadata, or ambiguous location is denied.
- Response contains only the approved location and status projection; no tokens, raw metadata, phone, customer, message or provider response body.
- D1 test double accepts SELECT only; no Queue binding is reachable from this route; no Meta/GHL provider call occurs.
- Inbound Meta signature, durable ingestion/idempotency and GHL Custom Provider publishing regressions pass. Outbound remains false and no live message is sent as part of smoke testing.

## Validation evidence and current blocker

- The focused canary/status, P0-1 diagnostic, inbound webhook, outbound, Custom Provider, and provider-outbound tests passed (61/61).
- The pre-0042 schema compatibility and tenant-isolation script passed.
- Scoped P0-4 TypeScript passed. Full repository TypeScript remains blocked by the unrelated missing `fusionlab360-console/console-api/src/index` import in `tests/domain/console-service/manual-reply.test.ts`.
- `git diff --check` passed; a separate scan found no trailing whitespace in the untracked candidate files.
- Wrangler production dry-run bundled successfully and exited 0, showing the expected production D1, Queue, AI, Vectorize and version-metadata bindings. Wrangler emitted a log-file `EPERM` warning because its default user log directory is outside the writable workspace; this did not prevent the dry-run bundle.
- `npm ci --offline --ignore-scripts` reported 0 known vulnerabilities across 45 packages. It also warned that `crypto-js@4.2.0` is deprecated and no longer maintained; it is in the runtime bundle for documented HighLevel context decryption and should be replaced only with a separately validated compatible WebCrypto implementation.

No deployment, production flag change, migration, credential update, message send, or replay is performed by this candidate task.

**Release status:** blocked from production activation until the missing production Shared Secret is securely provisioned and genuine production GHL context decryption is verified. Source is prepared for controlled release review; the page is default-off.

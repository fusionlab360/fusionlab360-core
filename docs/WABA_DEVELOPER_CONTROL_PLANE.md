# WABA developer-managed control plane

This is the local implementation contract for developer-operated WhatsApp
connections. It extends the existing Core integration API, Meta credential
vault, GHL OAuth records, connection lifecycle migration, and append-only audit
triggers. It does not add a customer dashboard or self-service activation.

## API operations

| Operation | Route | Permission | Behavior |
| --- | --- | --- | --- |
| Provision Meta integration | `POST /integrations/meta-whatsapp/provision` | `integrations:write` | Creates or returns the tenant-owned integration record. |
| Register an unverified connection | `POST /integrations/meta-whatsapp/connections` | `integrations:write` | Stores only a pending connection; it does not create credentials or enable messaging. |
| Inspect tenant connections | `GET /integrations/meta-whatsapp/connections` | `integrations:read` | Bounded tenant-only connection and sanitized credential-health metadata. The response never includes ciphertext, tokens, scopes, or message content. If 0042 is absent, lifecycle state is `not_migrated`. |
| Start state-bound Meta onboarding | `POST /integrations/meta-whatsapp/onboarding/sessions` | `integrations:oauth:connect` | Issues one-time tenant/operator-bound OAuth state. |
| Verify Meta authorization | `POST /integrations/meta-whatsapp/onboarding/complete` | `integrations:oauth:connect` | Uses the existing Graph onboarding adapter to verify WABA access, phone membership, app subscription, scopes and credential lifetime before storing the encrypted credential. |
| Activate, suspend or revoke | `POST /integrations/meta-whatsapp/connections/:connectionId/lifecycle` | `integrations:write` | Requires the lifecycle gate and protected 0042 schema. Tenant and actor come from authenticated context; request fields cannot choose them. |

The management inventory works against the pre-0042 schema. Lifecycle writes
return `503 SCHEMA_NOT_READY` until the expected 0042 transition/audit triggers
are present. No request creates or migrates schema. New onboarding completion
is blocked before any Meta API call when 0042 is absent; reauthorization on an
old schema is limited to a connection that was already status-active. On a
migrated schema, onboarding leaves new connections `pending`, and dispatch
denies them until separate activation. `legacy_active` activation also
requires the 0045 approved review and no later rejection/conflict record.
The pre-0042 fallback is limited to the specific missing `activation_state`
column error; other lifecycle-query failures deny dispatch and stop onboarding
before any Meta provider call.

Lifecycle mutation requires `WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED="true"`.
It remains `false` in the checked-in Wrangler defaults. Activation additionally
requires the tenant-qualified reference (`<tenant-id>:<evidence-reference>`) to appear in
`WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST`; entries are tenant-qualified
and this defaults to the empty
string. The operator must first independently verify the external GHL provider
installation and asset ownership, then stage that evidence reference through a
separately reviewed configuration operation. An arbitrary caller-supplied
reference cannot activate a connection. Suspend and revoke still require a
bounded evidence reference and justification for audit, but do not depend on
the activation allowlist, so an empty approval list does not prevent disabling
a connection.

For activation, Core independently rechecks all of the following:

- The Meta connection and integration belong to the authenticated tenant.
- The Meta credential is active, has the messaging and management scopes, and
  has valid verified expiry metadata. The token is not decrypted for this check.
- A connected GHL OAuth credential belongs to this tenant and exact location.
- The GHL Custom Conversation Provider is enabled and the location is
  allowlisted in server configuration.
- The submitted provider ID matches the provider ID stored in the tenant's GHL
  integration configuration; existing connection mappings cannot be changed
  during reactivation.
- A legacy connection has an approved 0045 review before it can become active.

The repository does not currently have an authoritative GHL API result proving
that a particular Custom Conversation Provider is installed for a location.
The evidence allowlist is therefore an explicit developer-reviewed gate, not a
claim of automatic Marketplace verification. A live production rollout remains
blocked until the operator's installation evidence and the 0042/0045 migration
plan are reviewed. Do not infer approval from connection status or message
activity.

Suspension changes lifecycle state and appends audit through the migration
trigger. Revocation also changes the legacy connection status to `disabled` and
clears the stored Meta ciphertext/nonce using the existing credential
repository. If credential revocation fails after the lifecycle transition, the
connection remains disabled/revoked and the API returns
`CREDENTIAL_REVOCATION_PENDING`; retrying the revoke action safely finishes the
credential cleanup. Neither action calls Meta or GHL.

The audit actor is the authenticated API client ID. The append-only audit row
records tenant, connection, location, prior/new state, a bounded evidence
reference, reason, trace ID, and timestamp. Operator identity and tenant IDs in
request bodies are ignored. Justifications must not include credentials,
customer information, or message content.

## PowerShell helper

`scripts/waba-connection.ps1` is an HTTPS-only API helper. It requires the
operator to confirm the exact HTTPS origin before prompting for the tenant API
key as a `SecureString`, disables HTTP redirects, requires an exact confirmation
for every mutation, and requires an extra explicit switch and production
confirmation for `api.fusionlab360.com`. It does not send credentials in URLs
or command-line arguments. It supports listing, provisioning, pending registration, the
existing state-bound onboarding completion, and lifecycle actions. It does not
call D1 directly and does not expose the developer-test token endpoint.

Examples (use an approved nonproduction host for local acceptance):

```powershell
pwsh -NoProfile -File scripts/waba-connection.ps1 `
  -ApiBaseUrl https://<approved-core-host> -Operation List

pwsh -NoProfile -File scripts/waba-connection.ps1 `
  -ApiBaseUrl https://<approved-core-host> -Operation Activate `
  -ConnectionId <tenant-owned-connection-id> `
  -GhlLocationId <verified-location-id> `
  -GhlProviderId <stored-provider-id> `
  -EvidenceReference <pre-approved-evidence-reference> `
  -Justification "Verified provider and asset ownership in approved record"
```

The operator first confirms Meta authorization through the existing state-bound
onboarding routes. A successful OAuth completion records an active, verified
credential while returning `activationState: pending` for a new migrated
connection; it remains ineligible until explicit activation. The developer-test
onboarding route remains restricted by its existing tenant/WABA/phone tuple;
this work does not broaden it.

## Release and activation order

1. Keep production traffic on the current safe version and all new gates off.
2. Independently inspect production D1 migration history. If lifecycle writes
   are needed, apply only the reviewed forward-compatible sequence under a
   separate database approval; never replay an applied 0042.
3. Independently verify GHL Marketplace provider installation, GHL OAuth
   location/company ownership, Meta WABA/phone ownership, webhook subscription,
   required scopes, and credential lifetime. Record evidence without copying
   tokens or customer content.
4. Configure only the approved evidence reference; keep lifecycle and outbound
   gates off until a separate activation review.
5. Use the authenticated API to activate the exact connection. Verify its
   audit record and tenant-scoped status projection.
6. Test inbound continuity first. Outbound remains behind its global kill
   switch and per-connection lifecycle enforcement. A single-location text
   pilot requires separate approval; do not send test messages during this
   local readiness work.
7. Rollback by disabling the connection through the authenticated API, then
   restoring the known-safe Worker version if code/config verification fails.
   Do not replay `UNKNOWN` deliveries.

## Acceptance gates

- **Single-location pilot:** independently verify the exact tenant/location,
  provider, company installation, Meta phone/WABA, user permission, current
  credential lifetime, webhook subscription, and 24-hour human text policy.
  Enable only the one connection after the migration/review and production
  release approvals.
- **Second tenant:** provision a distinct GHL OAuth location, provider
  installation, Meta WABA/phone and encrypted credential; verify it with
  separate evidence. Confirm Tenant A activation cannot change Tenant B,
  tenant-scoped status never crosses ownership, and callback/receipt correlation
  remains bound to the correct connection and conversation.
- **Unsupported until separately built:** template/marketing sends, media,
  interactive messages, customer self-service management, automated external
  alerts, and automatic legacy approval.

STAAH remains an isolated mock capability; this WABA work does not change its
provider support status.

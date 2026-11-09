# Meta WhatsApp Production Readiness Checklist

Status: **Local implementation complete; production acceptance not verified.**

This checklist records source and mock-test evidence for the Meta WhatsApp hardening work. It does not record a production deployment, configuration change, data migration, Meta API call, or live message test.

## Local code evidence

- [x] OAuth state remains single-use and tenant/operator-bound. Reauthorization state also binds the existing connection, WABA, phone number, and expected credential version. A caller cannot substitute another asset or replace a newer credential version.
- [x] Meta access tokens remain encrypted in the existing tenant/integration/connection-bound credential vault. API routes return connection identifiers, lifecycle state, or sanitized verification checks; they do not return credential values.
- [x] Onboarding checks token validity, app ownership, required WhatsApp scopes, WABA access, phone membership, phone registration state, and the existing app subscription before activation.
- [x] `GET /integrations/meta-whatsapp/connections/{connectionId}/verification` checks an existing tenant-owned connection using `integrations:test`. It performs read-only Meta Graph reads and does not mutate credentials, connection state, WABA subscriptions, or phone registration.
- [x] The webhook reader caps the raw Meta request at 10 MiB before buffering, verifies HMAC over the exact received bytes, and returns `413` for oversized bodies. Malformed lengths/UTF-8 return `400`; durable persistence or Queue failures return a safe retry response.
- [x] Outbound delivery requires the existing global outbound switch. It rejects invalid/future 24-hour-window timestamps, persists Meta `429` cooldowns, and does not automatically resend ambiguous timeouts or server errors.
- [x] Legacy outbound records using the prior text-only hash remain idempotent only when their stored connection, conversation, and recipient match the request.
- [x] Tenant scoping, credential version races, webhook recovery, raw-byte signature validation, and existing two-tenant inbound behavior have local regression coverage.

Local validation is recorded in the implementation result; tests use synthetic credentials, mocked Graph responses, and in-memory databases only.

## Production blockers

- [ ] Review and approve the local implementation commit before any release preparation.
- [ ] Apply additive migration `0046_meta_whatsapp_outbound_retry_cooldown.sql` to production before enabling any Meta outbound route. The migration has **not** been applied. It adds nullable `retry_after_at` to the existing outbound delivery table.
- [ ] Stage and review the Worker version with production flags unchanged. No upload, deployment, traffic shift, or Cloudflare setting change has occurred.
- [ ] Confirm required production binding names and credential-key configuration through an approved name-only review. No production secret values were retrieved or changed.
- [ ] Confirm Meta app review/permissions, business ownership, the selected WABA/phone asset, token lifetime, webhook URL/field configuration, and business eligibility with an authorized operator. These are not proven by local tests.
- [ ] If verification reports no WABA app subscription, obtain separate approval for an operator to subscribe the app. The implementation deliberately checks the existing subscription and does not call the mutating subscription operation.
- [ ] If phone registration/verification is incomplete, obtain separate operator approval for Meta's registration steps. Meta's official collection documents phone registration as a `POST` requiring the account's two-step PIN; this implementation only reads phone status. [Meta Cloud API registration](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=folder-3880d23a-495c-4c5e-9146-2d9db8afb629)
- [ ] Keep outbound, lifecycle, and other release flags at their currently approved values until a separate release decision. A successful read-only verification is not message-delivery acceptance.
- [ ] Approve separate live inbound receipt and controlled outbound delivery checks, including recipient consent, customer-service-window eligibility, duplicate prevention, status callback reconciliation, monitoring, and rollback ownership.

The app-subscription verifier now uses a read-only `GET` view. Meta's maintained Business SDK exposes both read and create operations for WABA `subscribed_apps`; the production onboarding path uses only the read operation. [Meta Business SDK](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/whatsappbusinessaccount.py), [Meta subscribed-apps collection](https://www.postman.com/meta/whatsapp-business-platform/request/ju40fld/subscribe-app-to-waba-s-webhooks)

## First live verification, after separate approval

After the reviewed Worker version is deployed and the required schema is present, the first live check should be this tenant-authenticated, non-mutating request for one already-owned connection:

```http
GET /integrations/meta-whatsapp/connections/{connectionId}/verification
Authorization: Bearer <tenant API credential with integrations:test>
```

The route derives tenant identity from the authenticated principal and only returns safe check statuses/codes/actions. It will make read-only Meta Graph requests for token validity, permissions, WABA access, phone membership/registration, and app subscription. Do not include a credential value in a report or support ticket. If the route is unavailable or returns an unavailable check, stop and review its safe code before considering any provider mutation.

## Release decision

**Not GO for production activation yet.** Local implementation and regression evidence do not establish live Meta eligibility, correct production bindings, the state of the production WABA/phone, or successful inbound/outbound delivery. The additive migration and Worker code are both unreleased.

**Exact next approval:** authorize a controlled production rollout limited to applying additive migration `0046`, deploying this implementation with current secrets and feature flags unchanged, keeping Meta outbound disabled, and running one tenant-scoped read-only verification request against an already-owned connection. This approval excludes WABA subscription changes, phone registration, inbound test traffic, outbound sends, secret changes, flag activation, and any broader rollout. A separate approval is required for those actions.

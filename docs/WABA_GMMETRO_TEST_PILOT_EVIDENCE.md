# GM Metro Meta Developer Test Pilot Evidence

**Assessment date:** 2026-11-12
**Scope:** Supplied Meta developer-test assets and one existing `gmmetro` Meta connection. This note records identifiers and safe metadata only. It does not grant business ownership, connection approval, or permission to send messages.

## Operator authorization record

- **Authorization date:** 2026-11-12.
- **Authorization statement:** The user explicitly confirmed they are authorized to approve use of the Poliklinik Shaik Meta developer-test resources for the FusionLab360 `gmmetro` pilot.
- **Authorized test resources:** Meta App `2191314291480503`, test WABA `2182329942321588`, and test Phone Number ID `1452502451268655`.
- **Purpose and scope:** Isolated GM Metro development testing with the listed test resources and the GHL Location `Npx2IdDDRjXz2QW3Svx4` / Provider `6adf3e12b24f5676a1ef327b`. This is cross-business test-resource authorization only.
- **Explicit limits:** This authorization does not establish production phone ownership, approve legacy connection activation, authorize production use, or approve live messaging.
- **Proposed evidence reference:** `gmmetro-waba-devtest-20261112`.

The reference matches the repository's accepted reference syntax `^[A-Za-z0-9][A-Za-z0-9._:/-]{2,239}$` and is tenant-scoped by the API as `gmmetro:gmmetro-waba-devtest-20261112`. It identifies this dated test-resource authorization record. It must not be treated as evidence of prior production approval or Meta production-asset ownership.

## Meta dashboard screenshot observations

The user reports that previously supplied Meta dashboard screenshots showed the test WABA and Phone Number IDs above, matching Core connection identifiers, a configured callback URL, and the `messages` webhook field as subscribed. These are recorded as operator-reported screenshot observations. The screenshot files were not present in the repository or the inspected attachment directory for this task, so their contents, capture date, exact callback URL, and current dashboard state could not be independently reviewed. A dashboard subscription setting does not establish successful webhook delivery. No delivery success is claimed.

## Supplied identity tuple

| Item | Identifier | Evidence status |
| --- | --- | --- |
| Meta App | `2191314291480503` | Present in saved Worker metadata at `diagnostics/p01-source-recovery/production-worker-version.json` and in the observed production Worker binding inventory. |
| Developer-test WABA | `2182329942321588` | Present in the saved Worker metadata and in the observed developer-test WABA allowlist. |
| Developer-test phone number | `1452502451268655` | Present in the saved Worker metadata and in the observed developer-test phone allowlist. |
| Meta business portfolio | Poliklinik Shaik | Supplied for this assessment. No inspected record independently links this portfolio to GM Metro or the supplied connection. |
| Core tenant | `gmmetro` | Present in saved Worker developer-test and inbound tenant allowlists, and in the production D1 connection record. |
| Meta connection | `bef4feda-206f-491b-a1fe-f805bdeadf18` | Production D1 has this connection under tenant `gmmetro`, with status `active`, activation state `legacy_active`, and an active credential marked `developerTest=true`. |
| GHL location | `Npx2IdDDRjXz2QW3Svx4` | Production D1 has a connected OAuth credential at this location for the `gmmetro` GHL integration. |
| GHL conversation provider | `6adf3e12b24f5676a1ef327b` | Production D1 GHL integration settings contain this configured provider ID. |

Identifier matches establish configured association only. They do not establish ownership, consent, or cross-business authorization.

## Webhook subscription and Meta ownership

The checked-in [Meta readiness checklist](META_WHATSAPP_PRODUCTION_READINESS_CHECKLIST.md) describes an authenticated connection verification route that checks WABA access, phone membership/registration, app identity, required scopes, and the app subscription. It explicitly distinguishes read-only verification from subscribing the app. The user-reported screenshot observation above is not an API verification result. No result from that verification route, independently captured Meta subscription record, or production phone ownership record was found in the inspected local evidence.

The saved Worker metadata shows that the app, WABA, phone, and tenant identifiers are configured together in the developer-test allowlist. Production D1 marks the connection credential as developer-test. The user's explicit authorization recorded above supports use of these developer-test assets for the bounded `gmmetro` test purpose. It does not prove production asset ownership or that the phone is currently subscribed and deliverable through the expected webhook.

## GHL OAuth and provider verification

A bounded read-only production D1 query confirmed an enabled GHL integration and an OAuth credential at the supplied location. Safe credential metadata reported `connectionStatus=connected` and a nonempty company identifier. Integration settings contained the supplied `conversationProviderId`. No token, refresh token, ciphertext, customer record, or message payload was read.

This verifies the stored GHL installation/provider association at query time. It does not independently confirm current token validity or authorization from the Meta portfolio owner.

## Legacy binding, review, and activation gates

Production D1 shows `ghl_location_id` and `ghl_provider_id` are both `NULL` on the supplied connection. The connection is `active` at the provider status layer and `legacy_active` at the lifecycle layer. The Meta credential is marked `developerTest=true`. Read-only counts found no legacy review rows and no activation/review audit entries for this connection.

The source-defined developer-test gate allows only the configured tenant/WABA/phone tuple. That gate does not establish cross-business consent. The developer-test legacy-binding route requires authenticated `integrations:write`, a connection-owned credential marked `developerTest`, exact configured tenant/WABA/phone identifiers, a separate tenant-scoped test evidence reference, the tenant's connected GHL OAuth location and configured provider ID, and the pilot location allowlist. The write atomically fills only the two null GHL binding fields and appends a `developer_test_binding_established` audit event; it leaves `activation_state=legacy_active` and creates no legacy-review marker.

This test-only route uses `META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST`, separate from `WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST`. Its tenant-scoped entry shape for this record is `gmmetro:gmmetro-waba-devtest-20261112`; it is not currently configured. Server-side checks reject a developer-test reference from the production legacy-binding, legacy-review, and activation paths, including when an operator accidentally copies the reference into a production allowlist. The regular legacy-binding repository path also rejects a connection whose credential metadata marks it `developerTest`. The production legacy-review and activation requirements remain unchanged. The checked-in Wrangler configuration keeps the new allowlist empty in root, dev, and staging environments; no test evidence is currently configured for runtime use.

**Conclusion:** The user authorization recorded here permits use of the specified Meta developer-test resources for the stated test purpose. It does not establish production phone ownership, approve production legacy review or activation, or authorize live messaging. `gmmetro-waba-devtest-20261112` is reserved for the isolated developer-test binding evidence path; it must not be added to `WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST` or `WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST`. Before a separate release/configuration approval populates the test-only allowlist, independently verify the test App/WABA/phone tuple and current webhook configuration through the existing read-only Meta verification path. The screenshots remain reported observations, not independent API verification, and no webhook delivery success is claimed.

## Missing evidence and minimum next step

Retain the dashboard screenshots or an equivalent dated export so the reported test WABA/phone IDs, connection identifiers, callback URL, and `messages` subscription setting can be reviewed. Independently verify the Meta app identity, test WABA access, phone membership/registration, required scopes, and webhook subscription using the existing read-only Meta verification path before populating `META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST`. Confirm the GHL OAuth location/provider association remains current through the normal tenant-scoped integration controls. For production legacy review, separately obtain evidence of prior production approval and production phone ownership. Do not reuse this test-resource authorization reference to satisfy production review or activation requirements.

After the read-only Meta checks pass, a separately authorized configuration change may add only the tenant-qualified reference to `META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST`. A later separately authorized call to the developer-test binding route can then perform the GHL association while preserving `legacy_active`. Keep `WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST`, `WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST`, lifecycle controls, and messaging flags on their independent production approval paths. The test binding operation itself does not approve review, validate credential usability, activate the connection, enable messaging, or authorize a live message.

## Evidence sources and limits

- `diagnostics/p01-source-recovery/production-worker-version.json` — saved Worker metadata with developer-test asset and tenant allowlist identifiers. It is a preserved snapshot, not independent ownership evidence.
- `docs/FL360_RELEASE_SOURCE_REGISTER.md` — prior release register showing the pilot tenant and location/company/app allowlists.
- `docs/WABA_0042_COMPATIBILITY.md` — legacy review evidence and activation requirements.
- `docs/META_WHATSAPP_PRODUCTION_READINESS_CHECKLIST.md` — connection verification and app-subscription checks.
- User authorization statement in the task dated 2026-11-12 — authorization to use the listed Meta developer-test resources for the `gmmetro` development pilot only.
- User-reported previously supplied Meta dashboard screenshots — observations recorded above; screenshot files were not available for independent review in this task.
- Read-only production D1 SELECTs on 2026-11-12 — connection lifecycle/status and GHL OAuth/provider metadata, plus review/audit counts. No credential values or message data were selected.

This task changed local source, test, checked-in default configuration, and documentation only. No D1 data, deployed Worker, secret, runtime allowlist value, lifecycle setting, messaging flag, or messaging setting was changed.

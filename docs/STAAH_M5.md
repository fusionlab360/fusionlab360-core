# FusionLab360 Core — STAAH M5 Mock Acceptance

## Status and boundary

M5 establishes a deterministic, local mock acceptance baseline for the
tenant-scoped STAAH management and reservation synchronization API. The mock
contract is internal to this repository. It is not evidence of compatibility
with an official STAAH payload or live service. Live mode remains unavailable
and fails closed.

The acceptance test mounts the real `src/domain/integration/staah-routes.ts`
routes and uses two authenticated API clients against an isolated in-memory
SQLite database with the repository migrations. It does not call production,
remote D1, STAAH, GHL, or any other external provider.

## Management API contract

Base path: `/channel-manager/staah`. All routes require an active API client
authenticated with a bearer API key. Tenant identity comes from the authenticated
client and is never accepted from request JSON or query parameters. Read
operations require `integrations:read`; mutations require `integrations:write`.
The authorization middleware checks the authenticated client and principal
permissions, and the service/repository further scopes each integration by
tenant, provider, and integration ID.

| Operation | Method and path | Permission | Request | Success |
| --- | --- | --- | --- | --- |
| Inspect connection | `GET /` | `integrations:read` | None | `{ success: true, connection }`; unconfigured tenants receive a `not_configured` view. |
| Create mock connection | `POST /` | `integrations:write` | JSON `{ syntheticPropertyId, simulateVerificationFailure?, mockFailureScenario? }` | `{ success: true, created, connection }`. Repeating creation is idempotent and returns the tenant's existing connection. |
| Inspect exact connection | `GET /:integrationId` | `integrations:read` | None | `{ success: true, connection }`; unknown or foreign IDs return the same 404 response. |
| Update mock configuration | `PUT /:integrationId` | `integrations:write` | Same allowed configuration fields as create | `{ success: true, connection }`; changes invalidate verification. Active sync leases prevent updates. |
| Verify mock connection | `POST /:integrationId/verify` | `integrations:write` | None | `{ success: true, connection }`; mock verification result is persisted. |
| Inspect property and mappings | `GET /:integrationId/property` | `integrations:read` | None | `{ success: true, property, mappings, mappingDiagnostics }`. Returns deterministic synthetic property, room, rate-plan and expected mappings. |
| Synchronize or manually retry | `POST /:integrationId/sync` | `integrations:write` | None | `{ success: true, sync }`; sync includes provider/mode, tenant and integration IDs, property ID, checkpoint and counts. |
| Disable | `POST /:integrationId/disable` | `integrations:write` | None | `{ success: true, connection }`; disables without deleting configuration. |
| Re-enable | `POST /:integrationId/enable` | `integrations:write` | None | `{ success: true, connection }`; resets verification to configured-but-unverified. |

Configuration is mock-only. `syntheticPropertyId` must match the `mock-` ID
format. Optional `mockFailureScenario` is one of `none`,
`provider_unavailable`, `timeout`, or `partial_batch_failure`.
`simulateVerificationFailure` is an optional boolean. Ownership/configuration
fields may not be used to select another tenant, provider, mode, or integration.
Unknown configuration fields are rejected.

## State and response semantics

Connection state and the latest sync checkpoint are separate:

- Connection: `not_configured`, `configured_not_verified`, `mock_verified`,
  `mock_verification_failed`, or `disabled`.
- Sync checkpoint: `idle`, `running`, `succeeded`, or `failed`.
- `connectionHealth.liveStatus` is always `live_not_configured`.
- `syncDiagnostics` reports the latest persisted attempt only; it is not a
  history store. Success/failure timestamps describe the latest attempt only.
- Retry eligibility is `eligible`, `connection_not_operational`, or
  `active_sync`. A manual retry does not guarantee success.
- Mapping diagnostics are `not_persisted`, `valid`, `missing`, or `conflicting`,
  with aggregate counts. Preview mappings are not persisted until sync.
- Sync counts are `processedCount`, `insertedCount`, `updatedCount`,
  `unchangedCount`, and `rejectedCount`.

The synthetic adapter supplies a fixed property catalog and deterministic
reservations. It includes duplicate delivery, a higher-revision modification,
a cancellation, a stale revision, and invalid mapping/data cases. The sync
normalizes these into canonical reservation records scoped by tenant, provider,
integration connection, property, and provider reservation ID.

Identical replay is unchanged and does not create another row. Only a higher
revision updates a record. Stale revisions are rejected without overwriting
newer state. Equal-revision identical content is unchanged; equal-revision
conflicting content fails with `reservation_revision_conflict` before the
checkpoint advances past that row. Earlier row writes are durable and safe to
replay.

Each sync uses a compare-and-set checkpoint and five-minute lease. A current
lease prevents overlapping syncs. An expired lease can be recovered by another
authorized manual sync. Failure checkpoints are retained; no automatic retry,
scheduler, polling loop, or bulk replay exists. Disabling invalidates a running
checkpoint. Re-enabling requires fresh mock verification.

## Stable error contract

Known operation failures return `{ success: false, code, message }` with a
sanitized message. The current stable codes include:

- Configuration and inspection: `invalid_configuration`, `invalid_mapping`,
  `invalid_checkpoint`, `connection_not_found`, `connection_disabled`,
  `state_conflict`, `persistence_failure`.
- Property and synchronization: `connection_not_found`, `connection_disabled`,
  `connection_unverified`, `mapping_invalid`, `sync_already_running`,
  `sync_lease_conflict`, `reservation_revision_conflict`,
  `provider_unavailable`, `timeout`, `partial_processing`,
  `persistence_failure`, and `sync_failed`.

The exact HTTP status is included in the thrown route/service contract: invalid
request/configuration is 400; unknown or foreign integration is 404; state,
authorization prerequisite, lease, mapping, and revision conflicts are 409;
provider and persistence failures are 503. Authentication failure is 401 and
insufficient scope is 403. Unknown internal route failures use a sanitized 503
response.

## Isolation and external side effects

The M5 route test creates two synthetic tenants and API clients. Each owns a
distinct integration and synthetic property, can inspect only its own property
and mappings, and receives its own checkpoint. The same provider reservation
IDs can be synchronized for both tenants without collisions because canonical
identity is tenant/connection/property scoped. Attempts by one tenant to
inspect, update, verify, disable, re-enable, inspect property data, or sync the
other tenant's integration return the same generic 404 response and leave the
owner's settings/checkpoint unchanged.

The test replaces `globalThis.fetch` with a throwing/counting guard and asserts
zero fetch calls. It also verifies no STAAH credentials, integration events,
or outbound-message delivery rows are created. The route's dependency graph
uses only the mock adapter and local D1 reservation persistence; it does not
invoke CRM, GHL, messaging, AI, booking, or event publication.

## Local validation

The test suite uses Node's SQLite database in memory and applies the repository
migrations in sorted order. The migration test checks legacy reservation rows
remain `NULL/NULL`, complete connection/property scopes, scoped uniqueness,
cross-tenant and cross-connection reuse, incomplete/blank pair rejection,
legacy updates, and ordered migration application. The M5 HTTP test covers
provisioning, persisted settings across requests, mock verification, property
and mapping inspection, sync, idempotent replay, modification/cancellation,
provider failure and recovery, disable/re-enable, permissions, ownership, and
side-effect guards. Separate focused tests cover equal-revision conflicts,
stale revisions, partial batch progress, retry, active-lease rejection, and
expired-lease recovery.

These tests use SQLite's implementation of the migration SQL. They do not prove
Cloudflare D1 runtime compatibility or validate migration application in a
deployed environment.

## Migration gate

`migrations/0028_reservation_provider_connection_identity.sql` is required by
scoped STAAH reservation writes. It adds nullable connection/property columns,
requires those two values to be both null or both nonblank, and creates a
partial unique index scoped by tenant, provider, connection, property, and
provider reservation ID. Local SQLite coverage passes. The migration remains
unapproved and unapplied remotely. Before deploying sync code to any
environment, the migration must receive separate review, be applied through
the authorized environment-specific migration process, and be verified against
that database. No remote migration or D1 operation is part of M5.

## Future live-adapter readiness

| Area | Current evidence | Still required before a live adapter |
| --- | --- | --- |
| Public documentation | STAAH publishes a public CRM API documentation site at [crmapidoc.staah.net](https://crmapidoc.staah.net/). The M1 review references it for product/profile discovery. | Obtain partner-confirmed documentation and selected product/profile version. The mock fixtures are not derived from this contract. |
| Partnership and profile | No live agreement or profile authorization is present in this repository. | STAAH partner approval and explicit confirmation of the CRM API profile/operations enabled for the account. |
| Authentication | Mock mode requires no provider credentials. | Official credential type, issuance, rotation, scopes/permissions, storage requirements, and authentication exchange details. |
| Endpoints and payloads | No live endpoint is implemented. | Official base URL, endpoint paths, request/response schemas, pagination, rate limits, error codes, and timeout guidance. |
| Property access | `mock-*` property IDs are synthetic and not authorization. | Provider-confirmed property identifiers and explicit property authorization for each tenant connection. |
| Identity and revisions | Mock fixture revisions are deterministic local metadata. | Stable reservation identity, update ordering/revision semantics, deletion/cancellation semantics, and reconciliation rules from STAAH. |
| Network access | No outbound request is made. | Confirm source-IP allowlisting requirements, egress addresses, TLS requirements, and partner network policy. |
| Live testing | No live test was performed. | Separate non-production provider account/property, synthetic bookings, approved credentials, observable request correlation, and a rollback/reconciliation procedure. |

The public documentation site is evidence that documentation is published; it
does not by itself verify the selected partner profile, credentials, endpoint
access, or payload semantics. Live implementation and live readiness remain
blocked until those items are confirmed.

## Completion boundary

M5 acceptance is limited to the local mock implementation and tests. It does
not establish live STAAH integration readiness, migration deployment
readiness, or production readiness.

# FusionLab360 Core — STAAH M4 Operational Diagnostics and Safe Recovery

## Scope and status

M4 extends the existing tenant-scoped STAAH mock management and synchronization
surface. It adds sanitized connection and latest-sync diagnostics, read-only
mapping inspection, and stable management error codes. Manual recovery reuses
the existing authorized sync operation. M4 adds no scheduler, queue, event,
table, credential, or provider connection.

All behavior described here is an internal synthetic mock contract. It does not
establish compatibility with any official STAAH API product or response.
Live mode remains unavailable and fails closed.

## Existing architecture reused

- The authenticated API client principal supplies tenant identity.
- The existing route guards enforce `integrations:read` for inspection and
  `integrations:write` for configuration, verification, enable/disable, and
  manual synchronization.
- `IntegrationRepository` reads and compare-and-set updates the tenant/provider
  integration row. The `integrations.id` is the integration and connection
  identity.
- The mock adapter is bound to tenant, integration, and connection context.
- The existing `ReservationRecordRepository` persists canonical reservations
  with the M3 tenant/connection/property identity.
- The checkpoint in integration settings and its five-minute lease remain the
  sole sync coordination and recovery mechanism.

No GoHighLevel, CRM, messaging, AI, event consumer, or external network path is
used by these operations.

## Connection diagnostics

`GET /channel-manager/staah` and `GET /channel-manager/staah/:integrationId`
retain their existing response fields and add `connectionHealth` and
`syncDiagnostics`.

`connectionHealth` reports the connection state, whether configuration exists
and parsed successfully, enabled state, explicit `mock` mode, the last
verification result/time, a bounded verification reason code, and
`live_not_configured`. A configured connection remains
`configured_not_verified` until the existing mock verification succeeds.
Disabled state takes precedence over prior verification. A mock verification
never represents live provider connectivity. Raw settings and credentials are
not returned.

Malformed saved settings fail closed with a stable code (`invalid_configuration`,
`invalid_mapping`, or `invalid_checkpoint`); the API does not claim that invalid
configuration is healthy.

## Synchronization diagnostics and checkpoint semantics

`syncDiagnostics` is a snapshot of the single latest checkpoint, not a history
of all sync runs. It exposes state, start/completion timestamps when stored,
counts, bounded error code, whether a non-expired lease is active, and retry
eligibility. A latest success/failure timestamp is populated only when that
latest checkpoint has that outcome. Older success/failure times are not
persisted and are not inferred.

Connection health and synchronization health are independent. For example,
`connectionHealth.state: "mock_verified"` can coexist with
`syncDiagnostics.state: "failed"` and
`syncDiagnostics.lastErrorCode: "reservation_revision_conflict"`. An expired
`running` checkpoint is reported as not currently in progress and is eligible
for the existing manual sync path when the connection remains enabled and
mock-verified.

The diagnostic `retryEligibility` values are:

- `eligible`: enabled, mock-verified, and no active lease.
- `connection_not_operational`: missing, disabled, or not currently
  mock-verified.
- `active_sync`: a current lease prevents another operation.

An eligible retry does not guarantee success: unresolved deterministic
revision conflicts still fail visibly until the underlying conflicting record
is reconciled. Counts reflect committed progress from the current/latest
attempt. No cursor moves past a failed write.

## Property and mapping inspection

`GET /channel-manager/staah/:integrationId/property` continues to return the
synthetic property and effective mappings. It adds `mappingDiagnostics` with
`not_persisted`, `valid`, `missing`, or `conflicting` status and aggregate
expected/persisted/missing/conflicting counts. Before the first successful
sync, deterministic expected mappings are previewed without being written.
Persisted values are inspected only within the authenticated tenant and exact
integration.

Mapping inspection is read-only. A mapping mismatch does not make sync
permissive: the sync path still checks exact expected mappings before
reservation persistence. The synthetic property ID is not STAAH authorization
or live property verification.

## Manual synchronization and recovery

`POST /channel-manager/staah/:integrationId/sync` is the single explicit manual
sync/retry operation and still requires `integrations:write`. It checks enabled
state and current mock verification before claiming a checkpoint. Its
compare-and-set claim blocks overlapping attempts; the active lease cannot be
bypassed. Expired attempts can be reclaimed by a new authorized invocation.

The operation replays the deterministic mock fixture from the beginning.
Scoped revision-aware persistence makes identical replay unchanged, prevents
older revisions from overwriting newer ones, and rejects same-revision content
conflicts. Partial progress remains committed and accurately counted; replay
continues from safe idempotent writes. The owner-checked checkpoint transition
releases the lease after success or failure. There is no automatic retry or
checkpoint-clearing operation. Configuration cannot be changed while an active
lease exists. Changing only a mock failure scenario preserves the last sync
checkpoint so the operator can inspect it; changing the synthetic property
resets mappings and checkpoint because those records belong to a different
property identity.

## Stable error contract

Error responses include `{ success: false, code, message }`. The code is a
bounded machine-readable classification; the message is sanitized and does
not include settings, reservation payloads, guest information, or provider
exception text. Current categories include invalid configuration/mappings/
checkpoint, missing/disabled/unverified connection, sync already running,
lease/state conflict, reservation revision conflict, provider unavailable,
timeout, partial processing, persistence failure, and generic sync failure.

## Authorization and isolation

Inspection and property/mapping diagnostics require `integrations:read`.
Configuration changes, verification, enable/disable, and sync require
`integrations:write`. Tenant identity is taken from the authenticated principal;
request-supplied tenant identity is not used. Repository queries and updates
include tenant, integration ID, and provider. There is no platform-admin
bypass.

## Mock/live boundary

M4 remains mock-only. No live STAAH requests, credentials, real reservations,
downstream processing, integration events, or GHL operations are performed.
No automatic synchronization or cron is enabled. A `mock_verified` status
means only that the local mock adapter accepted its bound context.

## Validation and remaining limitations

Focused tests use deterministic mock fixtures and local SQLite. They cover
connection/sync state separation, tenant and permission enforcement, mapping
diagnostics, safe retry, active and expired leases, revision conflicts,
partial progress, idempotent replay, and no external network or event
publication. Validation for this local change: 76 focused tests passed, 0
failed; `npx.cmd tsc --noEmit` passed; `git diff --check` and
`git diff --cached --check` passed.

The checkpoint stores only the latest attempt, so historical last-success and
last-failure timestamps cannot be recovered after a later attempt replaces the
checkpoint. A separate sync-history table is intentionally not introduced.
There is no official STAAH contract, live credential, agreement, approved
endpoint, authorized property, or staging provider connection.

Migration `0028_reservation_provider_connection_identity.sql` remains a
prerequisite for M3 scoped reservation writes. It has not been approved or
applied remotely. No M4 migration is needed beyond that existing M3 dependency.

## Future UI contract

A future UI can use the existing read routes for connection, latest-sync, and
mapping snapshots; `POST /:integrationId/sync` remains the explicit manual
retry action. The UI should use the returned state and stable error codes and
must not interpret mock verification as live connectivity. No frontend is part
of M4.

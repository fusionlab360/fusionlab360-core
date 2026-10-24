# FusionLab360 Core — STAAH M3 Mock Property and Reservation Sync

## Status and boundaries

M3 adds deterministic, local mock property/catalog retrieval and an explicitly
invoked reservation synchronization operation. It remains mock-only. It makes
no STAAH, GoHighLevel, messaging, CRM, AI, booking, payment, or other external
requests and emits no integration events. The fixtures below are internal test
contracts, not official STAAH API payloads.

Live STAAH remains unsupported: no partner credentials, agreement, approved
endpoint, or authorized live property are configured. `live` continues to fail
closed.

## Existing components reused

- M1 `resolveSTAAHAdapter()` binds the provider adapter to trusted tenant,
  integration, and connection identity. Its mock profile now supports the M3
  property, room/rate catalog, and synthetic reservation fixture operations.
- M2 persists the authoritative `staah` connection in the existing
  `(tenant_id, provider)` integration row and authorizes operators through the
  existing API client and `integrations:read` / `integrations:write` scopes.
- `ReservationPayload`, `ReservationLifecycle`, and
  `ReservationRecordRepository` remain the canonical reservation model and
  persistence boundary. M3 does not invoke `processReservation()` or
  `ReservationOrchestrator`, because those paths perform CRM contact/opportunity
  operations or emit normal integration events.

## Mock property, rooms, rates, and mappings

Property identity is taken only from the authorized, persisted connection's
`providerConfiguration.syntheticPropertyId`. A property read returns one
synthetic property, two mock room types, and two mock rate plans. Identifiers
start with `mock-`; names, addresses, dates, amounts, and guest names are
synthetic fixtures.

Default canonical resource mappings are deterministic. Each mapping contains
tenant ID, integration ID, provider key, provider property ID, resource type,
provider resource ID, and canonical resource ID. They are stored with the
tenant-owned integration settings during the first write-authorized
synchronization and compared with the adapter's expected fixture mapping
before use. Property/catalog reads derive the same mapping without mutating the
connection. Mapping identity includes the property, so matching
external room or rate identifiers cannot cross properties, connections, or
tenants. Changing the configured property clears those mappings and resets the
checkpoint.

## Reservation normalization and persistence

Mock reservation structures are explicitly internal. Normalization checks the
configured property, mapped property/room/rate references, reservation ID,
non-negative revision and amount, supported status, valid ISO calendar dates,
check-out after check-in, and modification timestamp. Invalid rows increment
the rejected count and are not persisted. Statuses map to existing lifecycle
values (`confirmed` or `cancelled`). Room/rate identities are stored in the
canonical reservation payload as mapped IDs. No CRM contact or opportunity is
created.

Migration `0028_reservation_provider_connection_identity.sql` adds nullable
connection and property identity columns to `reservation_records`. Its CHECK
constraint permits legacy rows only when both values are NULL, and scoped rows
only when both values are non-empty. A partial unique index enforces uniqueness
over tenant, provider, connection, property, and provider reservation ID for
scoped rows. Existing legacy rows retain NULL values and remain compatible.
The migration is local only and has not been applied to any remote database.
The new repository method is used only by the M3 mock path; existing reservation
repository methods retain their previous SQL contracts.

## Idempotency, ordering, and checkpoints

Reservation upsert is atomic against the scoped unique identity. A duplicate
with identical revision and canonical payload is unchanged. Only a strictly
higher fixture revision updates the row; an older revision is a terminal stale
rejection under the current mock contract. Different content at the same
revision is a conflict: synchronization fails with the safe
`reservation_revision_conflict` code, releases its lease through the existing
owner-checked checkpoint transition, and does not count or advance past that
row. Earlier committed rows remain durable and are safe to replay. A later
authorized run can recover after the conflicting stored/source data is
reconciled. The fixtures deliberately contain duplicate delivery, a
modification, a cancellation, and an older update after a newer revision.

The existing integration settings JSON stores a safe synchronization
checkpoint: status, attempt ID, start/lease/completion timestamps, processed,
inserted, updated, unchanged and rejected counts, and a bounded error code. No
guest payload or customer content is stored in the checkpoint. A compare-and-set
transition prevents overlapping active operations. The five-minute lease is
refreshed as rows are processed. Disabling a connection invalidates an active
checkpoint; a re-enabled connection must be freshly verified before sync.

Rows are committed individually. Progress advances after a successful write, an
identical replay, a stale-revision rejection, or a terminal normalization
rejection. A revision conflict fails before checkpoint advancement for that
row. If processing fails after earlier rows committed, the checkpoint reports
failure and the next manual run replays the deterministic fixture from the
beginning. The scoped upsert makes that replay safe; no cursor advances past
uncommitted work. No automatic retry, scheduler, cron, or Queue producer is
added. Mock failure scenarios include provider unavailable, timeout, and a
deterministic partial-batch failure; the operator can switch the mock scenario
back to `none`, re-verify, then invoke sync again.

## Manual operation

Routes are mounted under `/channel-manager/staah` and use the M2 tenant client
authorization. `GET /:integrationId/property` requires `integrations:read` and
returns the configured synthetic property and mappings. `POST
/:integrationId/sync` requires `integrations:write`; it takes the integration ID
from the route and tenant only from the authenticated principal. The operation
rejects missing/foreign connections, disabled connections, and connections
without a current `mock_verified` result. There is no bulk sync route.

The endpoint runs only local adapter fixtures and D1 persistence. It does not
publish integration events, call GHL, invoke CRM, or activate external
consumers.

## Tests

`src/integrations/channel-manager/staah/adapter.test.ts` covers mock capabilities,
deterministic fixture retrieval, connection binding, failure modes, and no
network activity. `src/domain/integration/staah-management.test.ts` retains M2
configuration and lifecycle coverage. `src/domain/integration/staah-routes.test.ts`
covers permission and tenant checks. `src/domain/integration/staah-sync.test.ts`
uses local SQLite and the authenticated route to cover mappings, normalization,
insert/update/cancel, duplicate and stale delivery, revision conflicts, replay,
failure checkpoint recovery, active-lease rejection, connection disable, tenant
isolation, no integration-event publication, and no network access. The
migration test in `src/persistence/repositories/durable-processing.sqlite.test.ts`
covers legacy rows and direct SQL insert/update attempts against the scope-pair
CHECK and unique index.

## Known assumptions and remaining blockers

- All provider responses and mock shapes are internal synthetic contracts; no
  official STAAH response was used to implement or validate M3.
- The mock uses a single synthetic property per integration configuration.
- Its revisions are reliable because they are explicit fixture metadata. This
  does not establish revision semantics for a real STAAH profile.
- The migration must be reviewed and applied through an authorized migration
  operation before deploying the sync code to any environment. No migration was
  executed in this task.
- Production or staging tenant configuration and property authorization have not
  been inspected. `mock_verified` is not provider authorization.
- M3B is complete only for isolated synthetic persistence. Live readiness is
  blocked on provider profile, contract, agreement, credentials, endpoint,
  property authorization, live idempotency/revision semantics, and a safe
  provider test environment.

## M3 completion status

- M3A mock property/catalog and deterministic mappings: implemented.
- M3B canonical normalization, scoped durable persistence, replay-safe
  idempotency, and sync checkpoints: implemented locally, pending migration
  rollout in a separately authorized environment.
- M3.2 local safety corrections add the scope-pair CHECK and fail synchronization
  on same-revision content conflicts. Migration 0028 remains unapproved and
  unapplied; local SQLite coverage does not replace a separate D1 rollout review.
- Live STAAH integration and downstream consumers: not implemented and out of
  scope.

# STAAH/GHL M6.1B — Shared Reservation Event Consumer

## Scope

M6.1B adds a provider-neutral consumer for an already persisted canonical
reservation integration event. It does not change STAAH synchronization and
does not emit events. M6.1C remains responsible for durable producer and commit
consistency.

The only enabled destination composition in this milestone is the explicit,
trusted GHL mock composition from M6.1A. Live GHL and live STAAH delivery remain
unsupported and fail closed.

## Existing mechanisms reused

The consumer uses `IntegrationEventRepository` and `IntegrationEventService`
for event lookup, atomic claims, leases, attempt counting, completion, retry,
and dead-letter persistence. It uses `ReservationRecordRepository` to load the
committed canonical reservation and the existing GHL `CRMAdapter` for contact
and opportunity operations. It does not introduce another queue, event store,
reservation store, retry engine, or CRM implementation.

Tests insert an already committed reservation and event into isolated local
SQLite persistence. They invoke `processReservationIntegrationEvent`, which
claims and completes the event through the normal durable event service before
calling the reservation handler.

## Event contract and canonical lookup

Supported event types are the existing canonical reservation event types. The
event must have aggregate type `reservation`, an integer revision, and a small
payload containing only:

- `canonicalReservationId`
- `sourceIntegrationId`
- `destinationIntegrationId`

Guest and reservation fields are not copied into event metadata. The consumer
loads them from the tenant-scoped canonical reservation record after ownership
validation. The aggregate ID, payload canonical ID, source provider, source
connection, and committed record must agree.

## Source and destination authorization

The source integration is loaded by event tenant and provider and must match
the payload integration ID and be enabled. The destination is loaded by event
tenant and the GHL provider and must match the payload integration ID and be
enabled.

Delivery is disabled by default. The destination integration settings must
contain an explicit trusted route:

```json
{
  "reservationEventDelivery": {
    "enabled": true,
    "mode": "mock",
    "sourceIntegrationIds": ["synthetic-source-id"],
    "locationId": "synthetic-location-id"
  }
}
```

Only `mode: "mock"` is supported. The source integration must be allowlisted.
The configured Location must match the tenant's persisted GHL credential
mapping, and the existing Location ownership lookup must resolve exactly to the
event tenant. There is no public route or tenant request field that activates
the test composition.

## GHL mock composition and delivery

A trusted dependency factory creates the synthetic `RequestContext`. The
consumer verifies its tenant, integration ID, provider, Location, and explicit
M6.1A `transportMode: "mock"` before any adapter operation.

Delivery performs the existing canonical mappings and adapter calls:

1. Upsert the contact.
2. Search for an opportunity by the configured reservation ID field.
3. Update the existing opportunity or upsert a new one.

The M6.1A transport supplies synthetic credentials and in-memory provider state.
Its default credential resolver throws, it never falls back to global `fetch`,
and its state is isolated per synthetic tenant and Location.

## Idempotency and partial failure

An event is marked processed only after both contact and opportunity operations
succeed. If contact upsert succeeds and opportunity delivery fails transiently,
the durable event remains failed and retryable. Reprocessing uses the existing
contact and reservation identities, so the mock adapter updates the same records
rather than creating duplicates.

This demonstrates replay safety for the synthetic transport. It does not claim
exactly-once behavior for live GHL.

## Revision policy

The repository stores only the current canonical reservation revision, not
historical snapshots. Therefore the consumer uses current-state reconciliation:

- Event revision equal to the committed revision: deliver current state.
- Event revision older than committed state: mark processed as a stale no-op.
- Event revision newer than committed state: reject as an invalid event because
  the referenced state is not committed.
- A processed duplicate: return without repeating provider effects.
- A same-revision retry after failure: repeat the idempotent destination upserts.

The consumer does not publish another reservation event after destination
acknowledgement.

## Error classification

- Malformed events, missing reservations, and future revisions: `INVALID_EVENT`.
- Invalid canonical or destination mapping: `PROVIDER_NORMALIZATION_FAILED`.
- Disabled destination or nonretryable provider rejection:
  `PROVIDER_REQUEST_REJECTED`.
- Unsupported type or live destination: `PROVIDER_UNSUPPORTED`.
- Tenant, source, destination, or Location mismatch: `TENANT_CONTEXT_INVALID`.
- Provider 429/5xx and unknown destination failures: retryable
  `PERSISTENCE_FAILURE`.

The existing event service applies its bounded retry and dead-letter policy.
Errors use sanitized messages and do not include event payloads, guest fields,
credentials, or provider response bodies.

## Local tests

Focused tests cover durable handler invocation, canonical lookup, contact and
opportunity delivery, duplicate processing, partial failure recovery, permanent
dead-lettering, stale/current revision behavior, cross-tenant rejection,
unsupported event types, missing Location ownership, live-context rejection,
global-fetch isolation, and absence of additional event emission.

All test data is fictional. Tests use an isolated migrated SQLite database and
the explicit M6.1A in-memory transport. No STAAH or GHL API is called.

## Limitations and M6.1C

M6.1B does not register STAAH sync as an event producer, does not make
reservation persistence and event persistence atomic, and does not add a Queue
envelope or production destination composition. Those are M6.1C concerns.
Migration `0028_reservation_provider_connection_identity.sql` is used by local
tests and remains unapproved and unapplied remotely.

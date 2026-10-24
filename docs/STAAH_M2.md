# STAAH M2 Persistent Mock Connection Management

> This document records the M2 baseline. M3 adds isolated synthetic property,
> catalog, and canonical reservation synchronization; see
> [`STAAH_M3.md`](STAAH_M3.md). The live STAAH limitations below still apply.

## Scope and status

M2 persists and manages a tenant-owned STAAH mock connection. It does not
connect to STAAH, create credentials, retrieve reservations, or authorize a
real property. `mock_verified` confirms only the local M1 adapter contract.
Live mode remains unsupported and fails closed.

## Core components reused

- The existing `integrations` D1 table and `IntegrationRepository` store
  provider identity, enabled state, and JSON settings. Its unique
  `(tenant_id, provider)` index limits a tenant to one `staah` row and
  arbitrates concurrent creation.
- The M1 `resolveSTAAHAdapter()` performs mock-only verification and binds the
  request to tenant, integration, and connection identifiers.
- The established API-key authenticator, client resolver, principal, and
  permission scopes authorize management operations.

The general authenticated request middleware constructs a legacy `Tenant`
context whose CRM mapper requires GoHighLevel. That is unsuitable for a
STAAH-only tenant. The dedicated route therefore uses the same authenticated
API client and database-backed permissions, and checks that the principal's
tenant is active, without constructing the CRM-dependent context. It accepts no
tenant identifier from the caller: each client can manage only its own tenant.
Platform-wide cross-tenant administration is not implemented.

## Persistence and connection identity

No migration is required. A `staah` integration row uses the existing
`integrations.id` as both integration identity and M1 `connectionId`. Its
`settings` JSON has this shape:

```json
{
  "providerConfiguration": {
    "category": "channel_manager",
    "mode": "mock",
    "profile": "crm",
    "syntheticPropertyId": "mock-property-example",
    "simulateVerificationFailure": false
  },
  "verification": {
    "currentStatus": "configured_not_verified",
    "lastAttemptAt": null,
    "lastResult": null,
    "reason": null
  }
}
```

The property identifier must start with `mock-`; it is synthetic and has no
provider authorization meaning. No row is added to `integration_credentials`,
and no STAAH or GoHighLevel credential is read or stored by this workflow.

## Management operations

Base path: `/channel-manager/staah`.

| Operation | Route | Permission | Behavior |
|---|---|---|---|
| Inspect current tenant connection | `GET /` | `integrations:read` | Returns `not_configured` when absent; otherwise safe settings/status. |
| Create mock connection | `POST /` | `integrations:write` | Requires `syntheticPropertyId`; creation is idempotent under tenant/provider uniqueness. |
| Inspect exact connection | `GET /:integrationId` | `integrations:read` | Tenant/provider/id scoped; foreign or unknown IDs return 404. |
| Update mock settings | `PUT /:integrationId` | `integrations:write` | Supports synthetic property ID and deterministic mock-failure switch; invalidates current verification. |
| Verify | `POST /:integrationId/verify` | `integrations:write` | Calls M1 mock adapter only and persists the result and timestamp. Disabled rows cannot be verified. |
| Disable | `POST /:integrationId/disable` | `integrations:write` | Sets existing `enabled` state false and retains configuration/history. |
| Re-enable | `POST /:integrationId/enable` | `integrations:write` | Preserves settings, enables the row, and resets current status to unverified. |

Explicit `mode` or `profile` values are accepted only when they are `mock` and
`crm`. Ownership fields, unknown fields, real-looking property IDs, and attempts
to select another provider are rejected. The integration row's provider,
tenant, and ID are checked on every operation. Mutating settings use
compare-and-set updates, and re-enable changes enabled state and invalidates
verification in one conditional update.

## Statuses

- `not_configured`: no tenant-owned STAAH row exists.
- `configured_not_verified`: current settings have not passed a fresh mock
  verification, including after configuration changes or re-enable.
- `mock_verified`: the M1 mock adapter accepted the persisted tenant/integration
  context.
- `mock_verification_failed`: mock verification returned a failure.
- `disabled`: the existing integration row is disabled; stored verification
  history remains available in the response.
- `liveStatus: live_not_configured`: always reported; M2 does not establish a
  real STAAH connection.

## Tests

`staah-management.test.ts` covers persistence across service instances,
concurrent idempotent creation, strict mock/profile/ownership validation,
verification persistence, verification invalidation, disabled/re-enabled
lifecycle, tenant and integration ID scoping, no-network operation, and the
unconfigured state. `staah-routes.test.ts` exercises API-key authentication,
permissions, tenant scoping, and management operations through mounted HTTP
routes using a local D1 test double. The M1 adapter tests remain in place.

## Limitations and M3 prerequisites

There is no STAAH credential, signed partner agreement, approved endpoint, or
verified property authorization. No synchronization capability is exposed by
M2. The management API is scoped to the tenant belonging to the authenticated
API client; a future platform console that manages arbitrary tenants requires an
approved platform-admin principal and authorization policy. M3 must confirm the
STAAH product/profile, partner credentials, endpoint ownership, error/retry
semantics, approved test property, and Core canonical reservation contract
before adding live provider operations.

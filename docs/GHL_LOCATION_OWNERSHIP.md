# GHL Location ownership

A non-empty GHL Location has one tenant owner, including when that tenant is
inactive and its OAuth credential has no token. Company installations remain
shared and are not Location ownership records.

Location-to-tenant resolution rejects multiple matches. OAuth initiation,
credential synchronization and activation use that ownership check. OAuth writes
also check for another owner inside the write statement, preventing concurrent
OAuth assignments even on a database awaiting the migration.

Tenant provisioning uses the existing generated credential INSERT. Migration
`0027_enforce_ghl_location_ownership.sql` is required to enforce ownership for
those inserts and any other direct database writer, including concurrent writes.
The partial unique index includes pending, active, OAuth and PIT credentials,
normalizes surrounding spaces and leaves other providers unaffected.

## Rollout prerequisite

The migration is prepared locally, not applied. Before provisioning tenants in an
environment, an authorized operator must review the migration and run its read-only
duplicate preflight in that exact environment. The reported production result
does not establish the result of this normalized check. If it returns any rows,
stop and investigate ownership; do not auto-delete or reassign credentials.

Apply only through a separately approved migration operation. Index creation
fails on duplicates and does not repair or modify credential rows. Enable
provisioning only after the index is confirmed present. Existing Location,
Company, access-token and refresh-token records require no changes.

The existing CLI runs a file of provisioning statements. If the credential INSERT
is rejected, do not treat the operation as success or retry blindly: earlier
statements may already have created inactive tenant/integration rows. Inspect the
failed setup before any separately authorized cleanup. This fix does not change
that existing provisioning transaction behavior.

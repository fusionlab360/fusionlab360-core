# GHL credential encryption rollout

The production baseline is three GHL OAuth location records and one company
installation, with eight nonempty token fields outside the Core envelope.
The location access token is stored in `integration_credentials.api_key`.
Location refresh uses `integration_credentials.refresh_token`. Company tokens
use `oauth_installations.access_token` and `oauth_installations.refresh_token`.
Recount by store and field before execution. Record counts only.

## Local rehearsal

Run from the repository root with the installed toolchain:

```powershell
.\node_modules\.bin\tsx.cmd --test tests/persistence/repositories/ghl-credential-migration.test.ts
```

The fixture creates a dedicated local D1 emulator with a fresh UUID and only
synthetic records. It takes a cold copy of the isolated persistence directory
with the emulator closed, applies both conversions, and restores the copy
after closing the emulator again. It reopens the restored database and reads
back all eight fields. The fixture cleans up only its own temporary directory.

The standalone runner opens only a pre-existing synthetic target in the OS
temporary directory. The target directory is `fl360-ghl-p01-<UUID>`, containing
`target.json` with matching `name`, `id`, and `synthetic: true`, and a `d1`
persistence directory. Use a fresh UUID v4 and a name starting with
`fl360-ghl-p01-rehearsal-`. The fixture is the reference for target setup.
With the synthetic target identifiers in PowerShell variables:

```powershell
.\node_modules\.bin\tsx.cmd scripts/ghl-credential-migration.ts --database-name $rehearsalName --database-id $rehearsalId --store locations --batch 1 --key-version synthetic-v1
```

Run separately with `--store installations`. Dry run reports counts only.
For a local apply, supply the **synthetic** keyring through
`CORE_CREDENTIAL_ENCRYPTION_KEYS` in the process environment and add
`--apply`. Each invocation attempts one batch of 1–50 rows. Record each
store's `before`, `convertedRows`, `after`, and checkpoint independently.
`retry_required` means no row was changed while candidates remain. Inspect
the reason and recount before resuming. `complete` means the SQL selector
found no remaining legacy candidates. Validate decryption separately because
an envelope prefix alone cannot prove ciphertext integrity.

## Remote D1 recovery rehearsal

On 2026-11-12 UTC, Cloudflare Time Travel restored a disposable APAC D1
database containing two synthetic fixture rows. The database was
`fl360-p01-recovery-20261112-50a4fcba` (`a7b87d9f-e77e-43d1-80ee-20daf2260f4f`).
The database is retained for evidence and has no Worker binding.

- Recovery point: `00000000-00000008-00005121-3db4c8509d3e9c2768c1b585399fef91`,
  captured at 18:01:11.500 UTC after both original rows were verified.
- Later state: the update to row 1, deletion of row 2, and insertion of row 3
  were confirmed after the bookmark. The write command returned at
  18:01:56.853 UTC.
- Restore: Wrangler returned success and the requested bookmark in 3.164
  seconds. An ordered query matched both original rows 4.686 seconds after
  the restore command began. The update, deletion, and insertion were
  reversed. The observed loss boundary was the selected bookmark.
- Cloudflare returned undo bookmark
  `00000000-ffffffff-00005121-ddc8fb5926cdb17de9ac077cde56b40f`.
  It was recorded and left unused.

Cloudflare documents up to seven days of Time Travel on Workers Free and
30 days on Workers Paid. The rehearsal confirms a recent bookmark was
usable. It does not establish the account tier, the oldest recoverable
point, or production restore time. Restore overwrites its target in place,
cancels in-flight queries and transactions, and does not clone a database.
See [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Production approval gates and order

1. **Recovery and execution approval.** Assign an incident owner, database
   operator, key custodian, and release operator. Approve the RPO and RTO
   based on an isolated restore rehearsal and verified retention for the
   production account. The current production D1 returned a Time Travel
   bookmark. Cloudflare's restore overwrites the target in place and cannot
   clone production into staging. The synthetic remote rehearsal does not
   establish production recovery timing or retention. Verify any independently retained recovery
   artifact and its custody separately. The existing D1 schema report
   records an FTS5 limitation on the full SQL export path.
2. **Production execution package.** Review the private CLI and commands
   below. It calls the same repository methods through a pinned D1 REST
   target. It has no Worker route. Approve its use on a hardened operator
   host because the conversion processes real token values in memory.
3. **Key and compatible runtime approval.** Provision
   `CORE_CREDENTIAL_ENCRYPTION_KEYS` through the approved secret channel,
   configure `CORE_CREDENTIAL_ACTIVE_KEY_VERSION` explicitly, and enable
   `CORE_CREDENTIAL_LEGACY_READS_ENABLED` for the shortest approved window.
   Preserve and verify all other Worker bindings and flags. Approve a
   rollback Worker that can read both formats with the same keyring.
   Verify every serving HTTP and Queue consumer version, OAuth callback,
   GHL company and location refresh, inbound and outbound messaging paths
   in their approved modes, and tenant-scoped integration reads against
   mixed storage in staging before allowing an encrypted production write.
4. **Database write approval.** Record a fresh production pre-change
   bookmark and aggregate field counts before promoting the compatible
   runtime, because an OAuth write can create ciphertext before conversion.
   Confirm there is no incompatible serving Worker. Convert one location
   at a time initially, then the company store under its separate
   checkpoint. Compare-and-swap checks both previous token fields so a
   committed refresh wins. A partial run is expected to remain readable.
   Stop on unexplained counts, malformed envelopes, decryption failure,
   OAuth/refresh errors, messaging regressions, or Queue/DLQ deterioration.
5. **Closure approval.** Require zero nonempty legacy fields in both
   stores, stable ownership and record counts, successful authenticated
   decryptability for every nonempty field, and a no-op rerun. Compare
   against authorized changes during the window. Verify approved OAuth,
   integration, and messaging health indicators and Queue/DLQ metrics,
   then separately approve disabling legacy reads and retiring the
   migration entry point. Any live provider or messaging check needs its
   own authorization.

## Rollback

Stop conversion and keep the current database and key versions. Use only a
rehearsed, keyring-equipped, mixed-format Worker for traffic rollback.
Preserve completed ciphertext and newer writes. Repair forward and resume
from the two counts when safe. An older Worker without the required
keyring is unsafe once any encrypted write lands.

An in-place production restore is a separate incident decision. Quiesce
writers, capture the current bookmark, account for writes made after the
chosen recovery point, and agree on replay or reconciliation before
restoring. A D1 restore cannot undo a token rotation at GHL or reverse
messages already sent. Reconcile provider state and Queue effects before
resuming writers. Preserve key versions needed by any retained recovery
point.

See [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
and the [D1 schema assessment](D1_PRODUCTION_SCHEMA_DIFF.md).

## P01 production execution package

### Recovery and compatibility evidence

On 2026-11-12 UTC, production bookmark lookups succeeded at 8 and 29 days.
The 29-day timestamp was 2026-10-14 18:08:48 UTC. Wrangler rejected the
31-day request at timestamp validation. The observed window is **at least
29 days of bookmark availability**, consistent with Cloudflare's documented
30-day paid limit. Neither an exact oldest bookmark nor a successful
production restore was established.

The active Worker `ca2aff1b-27bd-4ae2-9b05-c7fbaf177750` serves 100% of
traffic and lacks all three Core encryption bindings. The other three
reviewed versions also lack them. **No uploaded version is a verified
ciphertext-compatible rollback target.** Use the known serving source
`c703950c1ee9a3f46c9e999fc47bdcfcd5320e43` as the candidate base for a
keyring-equipped bridge. Record the verified bridge version as the
rollback target for subsequent configuration changes. Establish a
separately reviewed compatible fallback for any release that changes
application code. Do not fall back to the current unkeyed version once a
credential writer has stored ciphertext.

Source inspection confirms HTTP authentication, GHL and Meta messaging
paths, Queue consumers, and OAuth install and refresh pass the Core
bindings to the existing credential runtime. Both repositories reject
unencrypted reads when compatibility is off and encrypt token writes
when the cipher is configured. These are source and local regression
results. Validate the staged runtime on an isolated staging database
using synthetic credentials in both formats before promotion. Verify
keyring custody and named bindings on
each proposed serving and rollback version.

Proposed recovery objectives for operator approval: **zero lost committed
D1 writes for routine Worker rollback**, and **15 minutes from the stop
decision to restored credential service and a verified health check**.
The latter is an operational target, not a measured production RTO.
An incident requiring D1 restore needs its own accepted loss boundary
and reconciliation plan. Do not adopt the synthetic restore time as
the production RTO or restore data simply to undo a conversion.

### Key generation, custody and rotation

After approval, a key custodian generates 32 random bytes with an approved
CSPRNG in the organization's secret management workflow. Store a JSON
object mapping a unique version label, such as `ghl-p01-v1`, to the standard
Base64 encoding of those bytes. Set `CORE_CREDENTIAL_ACTIVE_KEY_VERSION` to
that label. The production runner and bridge use the same custody-managed
keyring. Record only the version label, custodians, date and approvals.
Keep key material out of shell arguments, source, local dotenv files,
transcripts, and reports. Use a short-lived process environment injected
by the vault for the CLI, and the secret input prompt for Wrangler.

For a later rotation, distribute a keyring containing both versions to
readers and rollback Workers before switching the active label. Retain old
versions while any ciphertext or recoverable snapshot depends on them.
The plaintext conversion runner skips envelopes and does not re-encrypt
them. A future rekey needs a separately reviewed, compare-and-swap
procedure and verification by envelope key version before retiring a key.

### Preflight and bridge commands

These are operator commands for the later approved window. Run from the
reviewed release checkout. Keep `$approvedReleaseTag`, `$keyVersion`,
`$approvedBaseVersion`, `$bridgeVersion`, and `$rollbackVersion` in the
release record. Check each command's exit code before proceeding.

```powershell
$account = '298b73e651f29df3116dfe3a36234866'
$db = 'e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4'
$env:CLOUDFLARE_ACCOUNT_ID = $account
$w = '.\node_modules\.bin\wrangler.cmd'
$tsx = '.\node_modules\.bin\tsx.cmd'
$operator = 'scripts/ghl-credential-migration-production.ts'
$scope = @('--account', $account, '--database', 'fusionlab360-db', '--database-id', $db)
git rev-parse HEAD
git status --short
& $w whoami
& $w d1 info $db --config wrangler.jsonc --env= --json
& $w deployments status --name fusionlab360-core --config wrangler.jsonc --env= --json
& $tsx $operator @scope --store locations --mode plan
& $tsx $operator @scope --store installations --mode plan
```

Compare account and D1 identity, the active version and traffic, DB and
Queue bindings, and the reviewed 6/2 starting field counts. Use a
short-lived account-scoped D1 Read token in `FL360_P01_D1_API_TOKEN` for
plan and verify. Apply needs a separately issued D1 Write token. The
Cloudflare permission is account scoped. The CLI pins the specific
account, database name and UUID and does not take arbitrary SQL. Keep it
on a vault-backed operator host with no HTTP or SQL body capture, core
dumps, or debug tracing. REST results and compare-and-swap parameters
carry credential material over TLS. The CLI reports counts and fixed
error codes and does not save the values. Record operator, release ID,
UTC time, bookmark and returned checkpoints separately. Revoke the
temporary D1 Write token and end the secret-injected session afterward.

After approval, upload the exact reviewed bridge source as inactive with
the intended nonsecret variables. Inspect the resulting version before
provisioning a secret. Wrangler's version secret command bases its change
on the latest uploaded version. Serialize Worker uploads during this
step and verify that the expected base is latest immediately beforehand.

```powershell
& $w versions upload --config wrangler.jsonc --env= --name fusionlab360-core --keep-vars --strict --var "CORE_CREDENTIAL_ACTIVE_KEY_VERSION:$keyVersion" --var 'CORE_CREDENTIAL_LEGACY_READS_ENABLED:true' --tag "${approvedReleaseTag}-base"
& $w versions list --config wrangler.jsonc --env= --name fusionlab360-core --json
& $w versions view $approvedBaseVersion --config wrangler.jsonc --env= --name fusionlab360-core --json
& $w versions secret put CORE_CREDENTIAL_ENCRYPTION_KEYS --config wrangler.jsonc --env= --name fusionlab360-core --tag "${approvedReleaseTag}-bridge"
& $w versions view $bridgeVersion --config wrangler.jsonc --env= --name fusionlab360-core --json
& $w d1 time-travel info $db --config wrangler.jsonc --env= --json
& $w versions deploy "${bridgeVersion}@100%" --config wrangler.jsonc --env= --name fusionlab360-core --yes
& $w deployments status --config wrangler.jsonc --env= --name fusionlab360-core --json
```

Set the base and bridge variables from the actual returned version IDs.
Inspect the secret name and binding type only. Compare all other binding
names, types and nonsecret values with the serving baseline. Capture the
bookmark before promotion because a compatible OAuth writer can create
ciphertext before the batch runs. Promote only after the bridge and
fallback are approved. Confirm every serving version is compatible and
check the approved HTTP, OAuth and Queue health signals before apply.

### Conversion, verification and Worker rollback commands

Each apply attempts at most one row. The expected pending field count
must match a fresh plan for that store. Starting values of 6 and 2 are
illustrative for the reviewed baseline. A production refresh may
legitimately reduce them. Do not rerun on an ambiguous transport
failure until a new read-only plan reconciles the result.

```powershell
# With the approved write token and keyring injected by the vault
& $tsx $operator @scope --store locations --mode apply --confirm $db --key-version $keyVersion --expect-pending-fields 6
& $tsx $operator @scope --store locations --mode plan
# Repeat for locations with the freshly reviewed pending count.
& $tsx $operator @scope --store installations --mode apply --confirm $db --key-version $keyVersion --expect-pending-fields 2
& $tsx $operator @scope --store installations --mode plan
# With the read-only token and keyring, after both plans show zero pending
& $tsx $operator @scope --store locations --mode verify --key-version $keyVersion
& $tsx $operator @scope --store installations --mode verify --key-version $keyVersion
```

Expect six and two successfully authenticated nonempty fields
respectively. Verify is read-only and authenticates ciphertext against
each owner and field. Require both zero-pending plans and verified
decryptability before proposing a second inactive version with
`CORE_CREDENTIAL_LEGACY_READS_ENABLED:false`. Review that version's
metadata and obtain separate promotion approval. Retain the bridge
version and keyring as the configuration rollback.

```powershell
# After separate authorization and after both verification commands pass
& $w versions upload --config wrangler.jsonc --env= --name fusionlab360-core --keep-vars --strict --var "CORE_CREDENTIAL_ACTIVE_KEY_VERSION:$keyVersion" --var 'CORE_CREDENTIAL_LEGACY_READS_ENABLED:false' --tag "${approvedReleaseTag}-closed"
& $w versions view $closedVersion --config wrangler.jsonc --env= --name fusionlab360-core --json
# After confirming bindings and obtaining promotion approval
& $w versions deploy "${closedVersion}@100%" --config wrangler.jsonc --env= --name fusionlab360-core --yes
& $w deployments status --config wrangler.jsonc --env= --name fusionlab360-core --json
```

Set `$closedVersion` from the upload output. Verify that it retains the
same keyring binding and active version, and confirm health after promotion.

```powershell
# Separately authorized rollback to the reviewed, keyring-equipped bridge
& $w versions view $rollbackVersion --config wrangler.jsonc --env= --name fusionlab360-core --json
& $w versions deploy "${rollbackVersion}@100%" --config wrangler.jsonc --env= --name fusionlab360-core --yes
& $w deployments status --config wrangler.jsonc --env= --name fusionlab360-core --json
```

Stop migration batches during rollback. Verify that the selected Worker
can read the current database and confirm traffic and credential health.
Preserve all newer D1 writes. This procedure does not run a D1 restore.

References: [Cloudflare D1 Query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
and [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

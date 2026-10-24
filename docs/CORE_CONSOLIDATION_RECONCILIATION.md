# Core Consolidation Reconciliation — 2026-10-24

## Evidence and scope

The permanent repository is `D:\Important Fusion Migration\fusionlab360-core`
on `main`, originally at `d1c1011299abdcb3be07a779582e1a39deb4ade7`.
Before any edit, the following protected source snapshot was created and every
manifest entry was rehashed successfully:

- Snapshot: `D:\FusionLab360-SafeBackups\core-consolidation-20261024-204401`
- Snapshot manifest SHA-256: `B7CCAAACF977F8AF34043DB511B22D063D36A109230340D65115FE2C1C074EB4`
- Manifest entries: 2,089; verification failures: 0

The snapshot contains filtered source copies of Core, the staging and guard
worktrees, and the M1D candidate; unstaged and staged binary patches,
deleted-file inventories, status records, heads, worktree metadata, and the
Core Git configuration. Local D1 state, Wrangler caches, dependency folders,
logs, and private environment files were excluded.

`docs/reports/core-consolidation-20261024/file-comparison.csv` is the
file-level record. It lists each Core/staging/guard/M1D difference, relative
path, pre-consolidation SHA-256 values, difference type, and reconciliation
decision.

## M1D changes integrated

The verified M1D candidate manifest is
`29AE65559CA2E15ABD203865F533B3CAF3BB6260A1EBC4203107B55D95E5146B`.
Only its narrow default-off Queue safety delta was merged:

| Area | Permanent decision |
| --- | --- |
| `AppBindings` | Added optional `NEW_QUEUE_ENVELOPES_ENABLED`. A missing value is disabled. |
| Queue helper | Added `areNewQueueEnvelopesEnabled`; only the literal value `"true"` enables new envelopes. |
| Scheduled reservations | New `reservation` envelopes require the new gate. Legacy GHL handling is unchanged. |
| Meta WhatsApp webhooks | Durable event persistence remains active; Meta envelope publication requires the new gate. |
| Wrangler configuration | Production and staging explicitly set the new flag to `false`. |
| Tests | Added default-off coverage and made Meta/STAAH fixtures opt in explicitly. |

## Temporary worktree decisions

### `fusionlab360-m3b2-staging`

The staging worktree is an older partial implementation. Its old colocated
`src/**/*.test.ts` files are superseded by the current root `tests/` layout;
the full suite proves those current tests execute. Its embedded Console user,
membership, and bootstrap implementation remains Console-owned, and its old
Meta persistence paths are superseded by the current provider-specific
`src/integrations/messaging/meta-whatsapp/` layout. Its unique files and
patches are preserved in the protected snapshot rather than merged over newer
canonical modules.

### `fusionlab360-m3b2-guard-bootstrap`

The guard worktree was a temporary staging maintenance build. Its inbound
policy implementation would remove current bindings and patient-identity
integration from canonical Core, so it is not a valid merge source. Its four
changes and test remain preserved in the protected snapshot. Existing staging
configuration still has GHL inbound Queue processing disabled, while the M1D
gate independently fences new Meta/reservation envelope publication.

## Historical artifacts

Unreferenced one-off M6 review notes, prior production release reports, and
test-relocation scripts were moved into
`docs/reports/historical/core-consolidation-20261024/`. They are retained for
traceability and are not runtime inputs. The external snapshot preserves their
pre-move locations.

## Migration preservation

All migration files from `0001` through `0041` are retained, including both
intentionally distinct `0023_integration_event_processing.sql` and
`0023_knowledge_documents_fts.sql`. The D1-compatible `0035` correction and
the explicit OFF data migration in `0040_tenant_ai_auto_reply.sql` are kept
unchanged.

# P01 compatible Worker release manifest

Status: local candidate; no production key, upload, traffic change or conversion.
Base branch: `integration/fl360-core-consolidated` at
`c703950c1ee9a3f46c9e999fc47bdcfcd5320e43`.

## Candidate file inventory

Worker source changes already present in the local P01 diff:

- `src/persistence/repositories/credential-repository.ts`: bounds the
  location conversion to OAuth credentials and uses compare-and-swap writes.
- `src/persistence/repositories/oauth-installation-repository.ts`: bounds
  installation conversion by account type and uses compare-and-swap writes.

Operator and review files already present in the local P01 working tree:

- `scripts/ghl-credential-migration-counts.ts`
- `scripts/ghl-credential-migration.ts`
- `scripts/ghl-credential-migration-production.ts`
- `tests/persistence/repositories/ghl-credential-migration.test.ts`
- `tests/persistence/repositories/ghl-credential-migration-production.test.ts`
- `docs/GHL_CREDENTIAL_ENCRYPTION_RUNBOOK.md`
- `docs/CORE_SECURITY_P01_CLEANUP_INVENTORY.md`
- `docs/README.md`
- `README.md`

The shared cipher and mixed-format readers are in the base commit, including
`src/core/security/credential-storage.ts`, the two repositories, and the GHL
credential runtime. Review the complete working-tree diff and exact Git tree
again before committing; this inventory is not a commit authorization.

## Runtime compatibility

Location reads resolve through `GHLIntegrationCredentialResolver` and
`CredentialRepository.findByTenantAndProvider`. Company reads resolve through
the company OAuth runtime and `OAuthInstallationRepository.find`. The HTTP
integration runtime, Queue processing, OAuth callback, location refresh,
company refresh and GHL messaging paths pass the Core credential bindings to
those readers. Metadata-only ownership lookups do not decrypt tokens.

The cipher uses AES-GCM envelopes with a key version and owner/field context.
Both readers reject legacy plaintext unless
`CORE_CREDENTIAL_LEGACY_READS_ENABLED` is exactly `true`; they reject
ciphertext without the required key. Both GHL stores reject token writes
without a configured cipher. A mixed-format bridge therefore needs all
three bindings before it serves traffic. A missing or incomplete keyring
causes credential operations to fail rather than writing plaintext.

## Configuration and release order

Do not change `wrangler.jsonc`, D1, Queue, WABA flags or unrelated bindings
as part of this local candidate. The future, separately approved inactive
version needs:

1. `CORE_CREDENTIAL_ENCRYPTION_KEYS`: custody-managed JSON keyring secret,
   version labels mapped to 32-byte random keys encoded as Base64.
2. `CORE_CREDENTIAL_ACTIVE_KEY_VERSION`: an explicit nonsecret label present
   in the keyring.
3. `CORE_CREDENTIAL_LEGACY_READS_ENABLED`: `true` only for the approved
   conversion window; `false` after both stores are verified converted.

No production key has been generated or installed. Do not promote a version
until all three effective bindings, every other existing binding, and HTTP,
Queue and OAuth compatibility have been verified. The production Worker
`ca2aff1b-27bd-4ae2-9b05-c7fbaf177750` has no Core keyring binding and is
not a rollback target after any encrypted write. Retain the keyring-equipped
bridge as the rollback version when closing legacy reads. Older key versions
must remain available while any stored envelope or recoverable snapshot
depends on them. Never use D1 restore as a routine Worker rollback.

The preflight, one-row conversion, verification, and rollback command shapes
are in `docs/GHL_CREDENTIAL_ENCRYPTION_RUNBOOK.md`. Approval for key custody,
inactive upload, traffic promotion, credential conversion, and closing legacy
reads are distinct production gates.

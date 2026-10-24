# Production Release Baseline

Date: 2026-10-24

Status: `PRODUCTION_DEPLOYMENT_BLOCKED`

## Read-only baseline

- Worker: `fusionlab360-core`
- Active version: `16524281-c8b9-40e1-8a53-276ad2dd5833` at 100%
- Health: `https://api.fusionlab360.com/health` returned HTTP 200 with the expected healthy response.
- D1 resource: `fusionlab360-db`
- D1 ID: `e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`
- Fresh Time Travel bookmark: `00001eae-00000000-0000510e-71722a1f8f03620d3e9fb4ad346bf7c7`
- Redacted counts: 4 tenants, 3 API clients, 4 integrations.
- Production Queue: `fusionlab360-ghl-inbound`, producer and consumer `fusionlab360-core`.

## Migration state

The production migration tracker contains migrations through `0027`. The following are pending:

`0028`, `0029`, `0030`, `0031`, `0032`, `0033`, `0034`, `0035`, `0036`, `0037`, `0038`, `0039`, `0040`, `0041`.

The production database already contains `tenant_feature_settings`. Existing rows include explicit feature states, but the inspected rows do not establish an `ai_auto_reply` state for every tenant.

## Blockers

1. The checked-in production binding names the D1 `fusionlab360`, while Cloudflare lists the target resource as `fusionlab360-db`. The ID is correct, but this configuration mismatch must be reconciled before deployment.
2. The current Worker is the pre-release version while the complete migration chain is pending. A production upgrade rehearsal against the populated baseline is required before schema mutation.
3. Migration `0040_tenant_ai_auto_reply.sql` inserts `enabled=1` for every tenant lacking an `ai_auto_reply` row. The runtime default for a missing row is disabled. Applying it as written could silently activate automatic replies for tenants with unknown historical intent.
4. Queue pause/backlog status is not exposed by the available `wrangler queues info` output and was not mutated.

No production migration, deployment, Queue operation, credential change, provider call or rollback was performed.

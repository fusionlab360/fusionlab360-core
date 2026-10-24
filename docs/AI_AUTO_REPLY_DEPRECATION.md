# AI auto-reply setting deprecation

## Runtime contract

`ai_chat` is the sole tenant-level feature setting that permits automatic AI
chat responses. The inbound service reads it before automatic processing and
rechecks it immediately before an automatic send. A missing `ai_chat` row
uses the feature registry default.

The historical `ai_auto_reply` key is no longer registered as a tenant
feature and is never read by the automatic-reply path. Existing rows remain
unchanged because migration history and deployed data must be preserved.
Migration `0040_tenant_ai_auto_reply.sql` remains unchanged and inserts an
explicit historical OFF row (`enabled = 0`) only when a row is absent.

## Console compatibility

The existing internal Console endpoints remain available:

- `GET /internal/console/tenants/:tenantId/ai-auto-reply`
- `PATCH /internal/console/tenants/:tenantId/ai-auto-reply`

They retain their existing `features:read` or `features:write` requirement,
tenant-grant check, and tenant resolution. They now read and write `ai_chat`.
This preserves the existing Console client contract without leaving a second
automatic-reply authorization switch.

## Production cutover assessment (read-only, 2026-10-24)

The production aggregation read found four tenants. `gmmetro` has `ai_chat`
enabled and an historical `ai_auto_reply` row enabled, so this change retains
its existing automatic-reply eligibility. `gmmoments` has `ai_chat` disabled
and remains disabled. `gmmetro-test` and `poliklinikshaik_kotakemuning` have
no explicit `ai_chat` row, which resolves to the registered ON default, while
their historical `ai_auto_reply` rows are OFF. They would become eligible for
automatic AI responses if this code were deployed unchanged.

No production settings were changed. Deployment is blocked until the owner
explicitly approves the intended `ai_chat` state for those two tenants and,
if needed, an authorized setting update is applied through the established
feature service before deployment.

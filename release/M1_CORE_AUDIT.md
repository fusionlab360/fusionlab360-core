# M1 Core Release Audit

Date: 2026-10-24

## Scope

This audit is read-only. No production migration, Worker deployment, Queue operation, restore or provider call was performed.

## Repository evidence

- Branch: `main`
- HEAD: `d1c1011299abdcb3be07a779582e1a39deb4ade7`
- Canonical root: `D:\Important Fusion Migration\fusionlab360-core`
- Existing linked worktrees: canonical Core, `fusionlab360-m3b2-staging`, and `fusionlab360-m3b2-guard-bootstrap`.
- `.git\REBASE_HEAD` exists, but no `.git\rebase-merge` or `.git\rebase-apply` directory exists. It is treated as stale diagnostic metadata and was not removed.
- The worktree has more than 160 mixed modifications, deletions and untracked files. The changes include source, tests, migrations, configuration, Console-service code, Meta code, STAAH code and temporary artifacts.

## Runtime-area audit

| Area | Runtime entry point / evidence | Status | Release impact |
|---|---|---|---|
| Worker bootstrap and routes | `src/index.ts`, `src/bootstrap/routes.ts` | Implemented; typecheck and current tests pass | Candidate not isolated |
| API-key authentication | `src/core/security/authenticator.ts`, client resolver and authorization middleware | Implemented; compatibility tests pass | Existing `fl360_` behavior must remain in candidate |
| Tenant isolation | `src/middleware/authorization.ts`, tenant repositories and route guards | Implemented; authorization tests pass | Requires candidate review |
| GHL OAuth and refresh | GHL OAuth routes, credential repositories and GHL client | Implemented, mocked/local coverage | Live provider verification not performed |
| GHL contacts/opportunities | `src/integrations/crm/gohighlevel/*` | Implemented, mocked coverage | Live provider behavior unverified |
| GHL reservations | booking/reservation services and GHL adapters | Implemented, local coverage | Migration 0028 remains pending in production |
| GHL messaging/history | GHL messaging adapter, conversation/history routes | Implemented, mocked coverage | No live customer operation performed |
| Meta WhatsApp | `src/integrations/messaging/meta-whatsapp/*` | Implemented, local/mock coverage | No live Meta credentials or calls |
| Provider-neutral messaging | canonical messaging repositories and shared routes | Implemented, local coverage | Migrations 0031–0035 pending in production |
| Durable events/dead letters | integration-event repository/service and Queue consumers | Implemented, local coverage | Production Queue state not fully observable |
| Queue retry behavior | `src/domain/messaging/inbound-queue.ts`, event retry services | Implemented and tested | Production pause/backlog unknown |
| Knowledge retrieval | knowledge routes, retrieval services and Vectorize adapters | Implemented, local/mock coverage | Live Vectorize/provider evidence limited |
| Tenant feature settings | `src/domain/features/tenant-feature-service.ts`, feature routes | Implemented; missing `ai_auto_reply` resolves OFF | Migration 0040 pending remotely |
| AI outbound gates | `src/domain/messaging/inbound-service.ts` | Rechecks `ai_chat` and `ai_auto_reply` before automatic sends | Safe in current code; release candidate required |
| AI booking and handoff | booking controller/service and inbound decision flow | Implemented, local tests | Production behavior after schema upgrade unverified |
| Reservation synchronization | reservation repositories and integration-event consumers | Implemented, local tests | Migration 0028 populated-data upgrade unverified in production |
| STAAH | channel-manager adapter and local mock composition | Mock-only/local | No partner credentials; live activation is out of scope |
| Console service routes/grants | `src/domain/console-service/routes.ts`, grant migrations | Implemented, local authorization tests | Migrations 0036–0041 pending in production |
| D1 schema/repositories | `migrations/*.sql`, persistence repositories | Current source depends on post-0027 schema | Production upgrade not executed |
| Production bindings | `wrangler.jsonc`, dry run | D1 name corrected locally; Worker/Queue/Vectorize bindings resolve | Queue pause/backlog and old Worker compatibility unknown |
| Error/idempotency/logging | event/delivery repositories and sensitive logging tests | Implemented; current test suite passes | Candidate must preserve these hunks |

## Provider verification boundary

The available automated tests are local or mocked. They do not establish live GHL, Meta, STAAH, Vectorize or AI-provider behavior. Production health and read-only D1 checks were performed separately; no customer-facing provider operation was executed.

## Release conclusion

The implementation is broad and locally testable, but its intended production source cannot be determined from the current mixed worktree without a reviewed file/hunk manifest. M1 is therefore NO-GO.

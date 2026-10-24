# D1 Runtime Usage Matrix

Date: 2026-10-24

Classification reflects current Core source references plus live production object evidence. No object is removed or renamed by this release.

| Object | Origin | Runtime usage | Classification | Evidence/confidence |
|---|---|---|---|---|
| tenants | 0001 | Tenant resolution, provisioning, authorization, all provider repositories | ACTIVE | Direct repository/service queries; high |
| clients | 0002 | fl360_ API-key hashing, principal resolution, permissions, revocation | ACTIVE | `client-repository.ts`, auth middleware; high |
| integrations | 0003 | Provider configuration and tenant ownership | ACTIVE | Integration/configuration repositories; high |
| integration_credentials | 0004/0021 | GHL credentials, OAuth lifecycle, provider ownership | ACTIVE | Credential repositories and adapters; high |
| reservation_links | 0006/0007/0012 | Reservation/contact/opportunity identity | ACTIVE | Reservation repositories/services; high |
| reservation_records | 0011/0028 | Canonical reservation persistence | ACTIVE | Reservation repository and integration consumer; high |
| integration_events | 0008/0009/0023/0025 | Durable event recovery, leases, idempotency | ACTIVE | Event repositories and Queue consumers; high |
| integration_event_dead_letters | 0010 | Retry/dead-letter recovery | ACTIVE | Dead-letter repository; high |
| ai_conversation_sessions | 0013/0019 | AI conversation context and handoff state | ACTIVE | AI session repository; high |
| ai_agent_profiles | 0014/0022 | Tenant AI profile/instructions | ACTIVE | AI profile repository; high |
| ai_booking_sessions | 0020 | AI booking state | ACTIVE | Booking session repository; high |
| oauth_installations | 0016 | GHL/company OAuth installation state | ACTIVE | OAuth repositories/runtime; high |
| oauth_authorization_states | 0026 | OAuth state replay protection | ACTIVE | OAuth state repository/routes; high |
| knowledge_sources | 0017 | Tenant knowledge containers | ACTIVE | Knowledge repositories/indexing; high |
| knowledge_documents | 0018 | Tenant knowledge records | ACTIVE | Knowledge repositories/indexing; high |
| knowledge_documents_fts* | 0023 FTS | Lexical retrieval and triggers | ACTIVE/COMPATIBILITY | `lexical-retriever.ts`; high; export limitation |
| tenant_feature_settings | 0024 | AI/features reads and writes; missing AI auto-reply defaults OFF | ACTIVE | Feature service/routes; high |
| messaging_outbound_deliveries | 0025/0032/0033 | Durable outbound effects, retry and delivery status | ACTIVE | Delivery repository/adapters; high |
| meta_whatsapp_connections | 0029 | Meta connection persistence | FUTURE_DORMANT | Runtime adapter exists, absent in production; medium |
| meta_whatsapp_credentials | 0030 | Encrypted Meta credentials | FUTURE_DORMANT | Runtime adapter exists, absent in production; medium |
| messaging_connections | 0035 | Provider-neutral connection mapping | FUTURE_DORMANT | Canonical repository, absent in production; medium |
| messaging_conversations | 0031/0035 | Canonical inbox conversations | FUTURE_DORMANT | Messaging repository/routes, absent in production; high for new release |
| messaging_messages | 0031/0034/0035 | Canonical message history | FUTURE_DORMANT | Messaging repository/routes, absent in production; high for new release |
| console_users | 0036 | Core console user provider/bootstrap | FUTURE_DORMANT | Current Core routes/provider, absent in production; high dependency |
| console_memberships | 0036 | Core membership authorization | FUTURE_DORMANT | Current Core routes/provider, absent in production; high dependency |
| console_service_idempotency | 0037 | Console tenant provisioning idempotency | FUTURE_DORMANT | `console-service/routes.ts`; absent in production |
| client_tenant_grants | 0037/0039/0041 | Explicit service tenant/scope grants | FUTURE_DORMANT | Console service and auth routes; absent in production |
| console_service_clients | 0038 | Dedicated Console service marker | FUTURE_DORMANT | `console-service/routes.ts`; absent in production |
| historical reservation backup tables | outside migration history | No current static source references found | LEGACY_CANDIDATE | Present in production; retain and investigate before any cleanup |
| `_cf_KV` / `sqlite_sequence` | Cloudflare/SQLite managed | Platform/internal | COMPATIBILITY | Managed objects; never modify |

The absence of static references is not sufficient to delete an object. All compatibility and legacy candidates remain untouched.

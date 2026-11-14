# Integration registry

Status applies to the named evidence and scope. The statuses are PRODUCTION_VERIFIED, OPERATOR_VERIFIED, LOCALLY_TESTED, IMPLEMENTED_UNVERIFIED, PLANNED, DISABLED and KNOWN_LIMITATION.

| Capability | Owning source | Status and scope |
|---|---|---|
| Worker routing, API key/JWT auth and tenant scope | [Entry point](../../src/index.ts), [routes](../../src/bootstrap/routes.ts), [auth](../../src/middleware/auth.ts), [authorization](../../src/middleware/authorization.ts), [tenant resolver](../../src/tenants/service.ts) | PRODUCTION_VERIFIED for the observed webhook ownership mapping and CORS. Other surfaces are IMPLEMENTED_UNVERIFIED in this baseline. |
| GHL OAuth and integration lifecycle | [OAuth routes](../../src/domain/integration/oauth-routes.ts), [credential runtime](../../src/integrations/gohighlevel/credential-runtime.ts), [repository](../../src/persistence/repositories/integration-repository.ts) | PRODUCTION_VERIFIED for encrypted persistence and target enablement. |
| GHL CRM and Clinic Connector | [Contact routes](../../src/domain/contact/routes.ts), [GHL adapter](../../src/integrations/crm/gohighlevel/adapter.ts) | PRODUCTION_VERIFIED for note synchronization. OPERATOR_VERIFIED for contact and Contact Event create, update and delete. |
| GHL custom provider and canonical messaging | [Webhook](../../src/domain/messaging/webhook-controller.ts), [canonical message](../../src/canonical/message), [Queue](../../src/domain/messaging/inbound-queue.ts) | OPERATOR_VERIFIED for the recovered inbound chain, including human takeover. |
| Meta WhatsApp Cloud API and WABA bridge | [Meta webhook](../../src/integrations/messaging/meta-whatsapp/webhook-controller.ts), [routes](../../src/integrations/messaging/meta-whatsapp/routes.ts) | PRODUCTION_VERIFIED for gate metadata. Outbound and lifecycle enforcement DISABLED. |
| AI, human handoff and Knowledge/RAG | [AI routes](../../src/domain/ai/routes.ts), [retrieval](../../src/domain/knowledge/retrieval-service.ts) | OPERATOR_VERIFIED for observed human takeover. Other AI and RAG workflows IMPLEMENTED_UNVERIFIED here. |
| Reservations and ABS Hotel | [Reservation routes](../../src/domain/reservation/routes.ts), [ABS adapter](../../src/integrations/pms/abs-hotel/adapter.ts) | IMPLEMENTED_UNVERIFIED in this baseline. |
| STAAH | [Mock transport](../../src/integrations/channel-manager/staah/staah-local-mock.ts), [routes](../../src/integrations/channel-manager/staah/staah-routes.ts) | IMPLEMENTED_UNVERIFIED here. Local mock implementation exists. Live acceptance is outstanding. |
| Console | [Core Console routes](../../src/domain/console-service/routes.ts) | IMPLEMENTED_UNVERIFIED here. Console client stays outside Core. |
| Observability and recovery | [Inbound diagnostics](../../src/domain/messaging/inbound-diagnostics.ts), [operations runbook](../operations/GHL_CREDENTIAL_OPERATIONS.md) | PRODUCTION_VERIFIED for live-tail connection and D1 checkpoint. Historical API access is a KNOWN_LIMITATION. |

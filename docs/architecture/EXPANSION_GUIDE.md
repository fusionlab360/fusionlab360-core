# Extend Core

Use the existing [architecture](../ARCHITECTURE.md) and [integration registry](INTEGRATION_REGISTRY.md) to locate interfaces and owning files. Each change needs authenticated tenant scope, a [D1 impact review](D1_DATA_MAP.md), configuration registry entries for new bindings, scoped feature gates where appropriate, and tests for authorization and failure paths. Compare production bindings and routes in preflight. Obtain separate activation approval and document a rollback that can still read existing data.

| Extension | Established entry point and checks |
|---|---|
| CRM integration | Extend the existing CRM adapter contract through the integration runtime. Translate provider fields at the adapter boundary and test tenant-scoped contact ownership and partial failure. |
| Messaging provider | Normalize at the signed webhook adapter to the canonical message contract. Test provider scope, queue dispatch, deduplication and receipts before separately approved activation. |
| Hotel reservation provider | Implement the existing PMS adapter and canonical reservation mapping. Verify tenant/property ownership, retry behavior and reservation identity with fixtures. |
| Tenant or account | Use existing authenticated onboarding and repository patterns. Scope credentials and configuration to the tenant and preserve existing enablement. |
| OAuth installation | Extend OAuth routes and credential runtime. Preserve state, verified installation ownership, lease handling and versioned persistence. Test token rotation and rollback with synthetic credentials. |
| Webhook | Register in the existing route layer. Verify signature before trusting location and event metadata. Test invalid signatures and unsupported events. |
| Queue producer or consumer | Extend the existing envelope and dispatcher. Validate tenant scope, retry classification and idempotency. Compare consumer, retry and DLQ settings before rollout. |
| D1 migration | Use the existing forward-only sequence. Validate actual ledgers, constraints, legacy records and old-reader compatibility locally before approving remote work. |
| AI or Knowledge | Extend current domain and retrieval services. Preserve tenant indexing scope and human takeover. Test retrieval failures and authorization before activating new behavior. |
| Console module | Extend Core Console routes and existing client permission checks. Keep UI ownership in Console and test tenant isolation and API response compatibility. |

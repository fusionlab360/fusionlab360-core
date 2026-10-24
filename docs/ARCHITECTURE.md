# FusionLab360 Core — Architecture

## 1. Purpose

FusionLab360 Core is a generic, multi-tenant Integration Platform as a Service (iPaaS).

It provides shared infrastructure for tenant management, authentication, integrations, canonical data models, domain services, provider adapters, and API operations.

Business capabilities must be implemented within appropriate domain boundaries without turning the shared Core into an application dedicated to one business or industry.

## 2. Non-Negotiable Architectural Principles

1. Preserve the existing iPaaS architecture.
2. Preserve multi-tenancy and strict tenant data isolation.
3. Keep shared infrastructure generic and reusable.
4. Keep business-domain logic separate from provider-specific integration logic.
5. Reuse existing interfaces, services, canonical models, authentication mechanisms, and credential flows.
6. Avoid duplicate services, competing implementations, unnecessary abstractions, and parallel architectures.
7. Preserve existing API contracts and backward compatibility unless a change is explicitly approved.
8. Make the smallest safe change that solves the identified problem.
9. Treat existing working behavior as a compatibility requirement unless a defect is demonstrated.
10. Do not introduce an architectural redesign without explicit approval.

## 3. Architectural Boundaries

### Core Infrastructure

Responsible for shared capabilities such as request handling, authentication, tenant resolution, configuration, persistence infrastructure, logging, and common error handling.

Keep this layer independent of individual business use cases.

### Tenant and Integration Management

Responsible for tenant configuration, client access, provider integrations, integration metadata, and credentials.

Maintain tenant-scoped access and reuse the established credential management flow.

Do not introduce duplicate credentials for separate capabilities of the same provider unless explicitly required and approved.

### Canonical Models and Domain Services

Canonical models define the internal representation of business data.

Domain services implement business capabilities independently of provider-specific request formats.

Extend existing domain services and canonical models where appropriate. Avoid leaking provider-specific payload structures throughout the application.

### Provider Adapters

Provider adapters translate between canonical models and external provider APIs.

Keep provider authentication, request formats, response parsing, and provider-specific error handling within the appropriate adapter or integration boundary.

Do not embed provider-specific behavior in unrelated shared infrastructure.

### Reservation Domain

Reservation functionality is a dedicated business domain within the generic iPaaS.

Reservation-specific lifecycle logic, synchronization, and canonical reservation data must remain within appropriate domain boundaries.

Do not make the entire Core hotel-specific merely because reservations are an important capability.

### AI and Conversational Services

AI functionality must reuse the existing messaging, instruction, knowledge retrieval, context management, and domain service boundaries where available.

Keep conversational reasoning separate from authoritative business data and execution.

AI-generated responses must not bypass authentication, tenant isolation, authorization, domain validation, or integration contracts.

Do not introduce duplicate AI pipelines or knowledge systems without first examining the existing implementation.

## 4. Technology and Existing Implementation

The project has used the following technologies and capabilities:

- TypeScript
- Cloudflare Workers
- Cloudflare D1
- Wrangler
- Multi-tenant API authentication
- Canonical data models
- External provider integrations
- GoHighLevel integration
- Reservation synchronization
- AI messaging and knowledge retrieval

These are known project technologies, not proof that every component is complete or currently working.

The actual repository is the source of truth for implementation details.

The repository also contains an isolated STAAH channel-manager mock. M1 provides
the mock adapter foundation, M2 stores its tenant-scoped connection in the
existing `integrations` table, and M3 exposes synthetic property/catalog reads
and an authorized, manually invoked reservation sync into canonical
`reservation_records`. The M3 path does not call GHL, publish integration
events, or connect to STAAH. Live STAAH remains unsupported; the synthetic
contracts and `mock_verified` status do not prove provider authorization or
official STAAH API compatibility. The additive M3 reservation-identity
migration is local and must be applied separately before the durable sync path
is deployed.

Codex must inspect the source code, configuration, migrations, interfaces, and tests before documenting exact component responsibilities or claiming a capability is implemented.

## 5. Security and Data Integrity

Every implementation must preserve:

- Tenant isolation.
- Authentication and authorization.
- Secure credential handling.
- Input validation.
- Data integrity.
- Appropriate error handling.
- Idempotency where required.
- Safe retry behavior.
- Auditability and diagnostic logging without exposing secrets.

Never trust tenant identifiers, provider identifiers, or authorization claims supplied by a caller without the appropriate validation.

## 6. Extension Rules

Before adding a new capability:

1. Find the existing entry point and request lifecycle.
2. Identify the responsible domain service and existing interfaces.
3. Identify reusable adapters, models, repositories, and utilities.
4. Follow existing dependency and error-handling conventions.
5. Determine whether the change belongs in Core infrastructure, a domain, or a provider adapter.
6. Add only the minimum required extension.
7. Preserve existing integrations and tenant behavior.

## 7. Prohibited Changes Without Approval

Do not independently:

- Redesign the overall iPaaS architecture.
- Convert shared Core infrastructure into industry-specific logic.
- Replace established authentication or tenant resolution.
- Change canonical contracts or public API behavior incompatibly.
- Introduce a competing integration, messaging, or AI architecture.
- Create a second credential flow for an already integrated provider.
- Perform destructive database migrations.
- Change production secrets, environment configuration, or deployment behavior.

## 8. Architecture Documentation Maintenance

When an approved architectural change is implemented, update this document to reflect the verified new design.

Clearly distinguish current implementation, approved future plans, known limitations, and unverified assumptions.

Do not document intended behavior as implemented behavior.

## 8.1 Tenant AI Chat control

`ai_chat` is the sole tenant-level feature control for automatic AI chat
responses. Inbound processing checks it before any automatic AI-generated
send and rechecks it immediately before delivery. A missing `ai_chat` row
uses the centrally registered feature default.

`ai_auto_reply` is a deprecated historical setting. Migration 0040 and its
rows are retained for migration history and data preservation, but they are
not an independent runtime authorization gate. The legacy Console
`/tenants/:tenantId/ai-auto-reply` routes remain compatibility aliases for
the `ai_chat` setting and retain their existing feature permission and
tenant-grant checks.

## 9. Explicitly distinguish:

Existing architectural principles and intended extension points.

Currently implemented capabilities.

Provider-specific implementations and hard-coded deployment or seed configuration.

Planned capabilities and known limitations.

Use the verified findings from the previous review:

Tenant mapper currently selects GoHighLevel for CRM and uses "browser" for the PMS provider.

Booking resolver currently registers GoHighLevel.

PMS resolver currently supports ABS Hotel.

CLI configuration defaults to GoHighLevel.

Existing seed and Wrangler configuration contain concrete deployment choices.

Do not describe provider-neutral provisioning or universal provider selection as implemented unless verified in the code.


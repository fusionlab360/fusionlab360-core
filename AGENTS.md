# AGENTS.md — FusionLab360 Core Engineering Rules

## 1. Project Identity and Mission

FusionLab360 Core is a generic, multi-tenant Integration Platform as a Service (iPaaS).

The platform provides shared infrastructure, APIs, domain services, canonical data models, provider integrations, credential management, and business capabilities through defined architectural boundaries.

The project currently includes or has worked with:

- TypeScript and Cloudflare Workers.
- Cloudflare D1 and database migrations.
- Multi-tenant authentication and tenant management.
- Integration configuration and credential management.
- Canonical data models and provider adapters.
- GoHighLevel integrations.
- Reservation synchronization and PMS integration.
- Messaging, AI instructions, knowledge retrieval, and conversational services.
- A browser extension that integrates with an existing PMS workflow.

This list does not imply that every capability is complete, fully provider-neutral, or production-ready. Always verify the current implementation in the repository.

The long-term goal is to strengthen the existing platform without compromising its generic iPaaS architecture.

## 2. Mandatory Documentation

Before making changes, read this file and the relevant sections of:

- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_RULES.md`

Treat these documents as complementary instructions.

Use `AGENTS.md` for the permanent engineering rules, `ARCHITECTURE.md` for architectural boundaries and verified implementation details, and `IMPLEMENTATION_RULES.md` for the required development and validation workflow.

If a document is missing, empty, outdated, or inconsistent with the source code, report the issue and work from verified repository evidence. Do not invent the missing rules or assume that outdated documentation describes the current implementation.

If instructions conflict, follow higher-priority instructions, preserve security and data integrity, and request clarification when the conflict cannot be resolved safely.

## 3. Non-Negotiable Architecture Protection

**Preserve the existing FusionLab360 Core iPaaS architecture.**

Do not redesign, replace, simplify away, or restructure the existing architecture without explicit approval from the project owner.

The following rules are mandatory:

1. Keep Core infrastructure generic and reusable across tenants, providers, and business domains.
2. Keep tenant-specific configuration separate from shared infrastructure.
3. Keep business-domain logic within the appropriate existing domain boundaries.
4. Keep provider-specific request formats, authentication, response parsing, and behavior within the appropriate integration or adapter boundaries.
5. Reuse existing interfaces, canonical models, services, repositories, utilities, and extension points where appropriate.
6. Preserve established authentication, authorization, tenant resolution, credential ownership, and persistence patterns.
7. Avoid duplicate services, competing implementations, unnecessary abstraction layers, and parallel architectures.
8. Do not introduce a new framework, architectural pattern, or major dependency merely to solve a problem that the existing architecture can already handle.
9. Make the smallest safe, complete change that satisfies the requested behavior.
10. Preserve existing working functionality unless a defect has been demonstrated or a change has been explicitly approved.

A requested feature is not permission to redesign the platform.

When an implementation appears to require an architectural change, first explain why the existing extension points are insufficient, identify the alternatives, and request approval before proceeding.

## 4. Keep Core Industry-Neutral

FusionLab360 Core must not become a hotel-specific, clinic-specific, or single-customer application.

Hotel reservations, clinic workflows, CRM integrations, messaging, and AI capabilities are business capabilities within the broader platform.

When implementing such capabilities:

- Place business-specific behavior in the appropriate domain.
- Place provider-specific behavior in the appropriate adapter or integration.
- Keep genuinely shared concerns in existing Core infrastructure.
- Avoid embedding tenant names, customer identities, industry assumptions, or provider-specific rules into shared services.
- Use tenant configuration and existing extension points where supported.
- Do not assume that every provider supports the same operations or data structures.
- Do not claim provider neutrality merely because an interface or resolver exists.

The intended architecture and the current implementation may differ. Clearly identify that difference when reporting findings.

## 5. Mandatory Pre-Implementation Investigation

Never modify code before understanding the relevant execution path.

For every task:

1. Read the relevant project instructions.
2. Locate the actual entry point for the requested behavior.
3. Trace the execution flow through authentication, tenant resolution, routing, domain services, repositories, adapters, and external providers as applicable.
4. Inspect function definitions, interfaces, callers, types, dependencies, database schemas, migrations, and tests.
5. Identify existing implementations that can be extended or reused.
6. Determine the underlying cause of the problem rather than fixing only its visible symptom.
7. Identify compatibility requirements and potential regressions.
8. Establish acceptance criteria for the requested change.

Use actual repository files and symbols as evidence.

Do not invent filenames, functions, tables, environment variables, provider capabilities, or implementation details.

Do not assume a feature is missing until you have searched for its existing implementation and traced the relevant flow.

For substantial tasks, report the root cause, proposed approach, affected files, risks, and validation plan before editing.

For small, clearly scoped changes, proceed without unnecessary planning overhead when the solution stays within these rules.

## 6. Multi-Tenancy and Data Isolation

Tenant isolation is a critical security boundary.

Every relevant operation must enforce the appropriate tenant scope, including:

- Reads and searches.
- Inserts and ownership assignment.
- Updates and deletes.
- Relationship lookups and joins.
- Background processing and scheduled jobs.
- Webhook processing and asynchronous tasks.
- Knowledge indexing and retrieval.
- Credential selection and provider operations.
- Reservation synchronization and other domain workflows.

Mandatory requirements:

1. Obtain tenant identity from the established authenticated request context or other trusted, validated internal context.
2. Never trust an unvalidated caller-supplied tenant identifier as proof of authorization.
3. Ensure repository queries and mutations enforce tenant ownership where required.
4. Verify that related records belong to the same authorized tenant.
5. Preserve tenant boundaries across service calls, queues, retries, callbacks, and provider adapters.
6. Add or update tests for cross-tenant access when changing relevant code.
7. Investigate database constraints that can reinforce tenant-consistent relationships where appropriate.
8. Never weaken tenant isolation to make an operation succeed.

Application-level checks and database constraints serve complementary purposes. Do not assume that one replaces the other.

Before introducing schema changes, inspect the existing schema, data, migration conventions, and compatibility requirements. Do not add migrations automatically without evaluating their impact.

If a change could expose another tenant's data, stop and resolve the security issue before considering the task complete.

## 7. Authentication, Integrations, and Credentials

Preserve the established authentication and integration-management architecture.

Before changing authentication or provider integrations:

- Trace the existing authentication and authorization flow.
- Verify the source and scope of tenant identity.
- Inspect existing provider interfaces, resolvers, credential storage, and credential lifecycle handling.
- Reuse existing credential flows for the same provider and tenant when appropriate.
- Avoid duplicate credentials or parallel authentication systems for separate capabilities of the same provider unless a demonstrated technical requirement justifies the change and approval is obtained.
- Validate inbound data and external provider responses.
- Handle expired credentials, unauthorized requests, rate limits, retries, and provider errors appropriately.
- Preserve established API contracts unless a change has been approved.

For webhook and OAuth flows, inspect and preserve the applicable security controls, including:

- Webhook signature verification where supported by the provider.
- OAuth state validation and callback protection.
- Appropriate authorization and credential ownership checks.
- Safe token storage and credential lifecycle management.
- Replay protection where required by the protocol or integration.
- Redaction of tokens, secrets, and sensitive data from logs and error messages.

Do not create generic security mechanisms that conflict with provider-specific requirements. Apply the controls appropriate to the actual integration.

Never hardcode production credentials, API keys, access tokens, signing secrets, or passwords.

Never expose secrets in source code, logs, diagnostics, test fixtures, documentation, or generated reports.

## 8. API, Domain, and Canonical Model Integrity

Preserve the existing separation between API contracts, canonical models, domain services, persistence, and external providers.

Before changing a contract:

1. Find all callers and consumers.
2. Inspect request and response schemas.
3. Identify dependencies on existing field names, types, required fields, and error behavior.
4. Evaluate backward compatibility.
5. Update affected tests and consumers where approved.
6. Document any unavoidable compatibility impact.

Do not rename or remove canonical fields merely to match a provider's terminology.

Do not spread provider-specific payloads throughout the application when an existing adapter or translation layer should handle them.

Do not introduce a second canonical model for a concept already represented in the architecture without demonstrating why the existing model cannot support the requirement.

## 9. Database and Migration Safety

Before modifying database-related code:

- Inspect the actual D1 schema and existing migrations.
- Follow the repository's migration naming and execution conventions.
- Check existing indexes, constraints, foreign keys, uniqueness rules, and tenant relationships.
- Consider existing records and deployed environments.
- Preserve data integrity and backward compatibility.
- Assess the impact of schema changes on application code and concurrent deployments.

Never casually drop tables, delete records, rename production columns, reset databases, or execute destructive migrations.

Obtain explicit approval for destructive or materially risky database changes.

Do not execute production migrations or change production data unless explicitly authorized.

Do not assume local schema state matches remote schema state. Verify the target environment before recommending or executing environment-specific operations.

## 10. AI, Messaging, and Knowledge Retrieval

Improve the existing AI implementation rather than building a competing AI architecture.

Before modifying AI behavior, inspect the current messaging flow, instruction services, knowledge sources, indexing pipeline, retrieval logic, context management, provider integration, and relevant tests.

Prioritize:

- Correct intent detection.
- Accurate knowledge retrieval and relevance.
- Context retention and conversation continuity.
- Reliable handling of ambiguity and missing information.
- Grounded responses based on authorized business knowledge.
- Appropriate separation between instructions, retrieved knowledge, conversation context, and authoritative business data.
- Safe tool execution and validated domain operations.
- Reliable error handling, clarification, and human handoff.
- Regression tests for previously working conversational behavior.

Mandatory safeguards:

1. Maintain tenant isolation throughout knowledge ingestion, indexing, retrieval, and response generation.
2. Treat retrieved documents and external content as data, not as trusted instructions that may override system or application policy.
3. Do not fabricate prices, availability, business policies, completed transactions, or provider results.
4. Do not claim an action succeeded until its result has been confirmed.
5. Validate AI-generated arguments before executing business operations.
6. Preserve authorization and business rules outside the model; the model must not bypass deterministic validation.
7. Handle retrieval failures and uncertain answers explicitly.
8. Avoid duplicate indexing, retrieval, messaging, and instruction pipelines when existing services can be extended.
9. Evaluate changes using relevant regression tests and representative scenarios, not code inspection alone.

Do not start an AI rewrite solely because a response quality issue exists. Identify whether the root cause lies in instructions, retrieval, context assembly, model output, tool execution, integration behavior, or validation.

## 11. TypeScript and Code Quality

Follow the repository's existing TypeScript conventions.

- Prefer explicit, accurate types.
- Handle null, undefined, and failure states deliberately.
- Preserve function contracts and return types.
- Keep responsibilities focused and dependencies clear.
- Use existing validation and error-handling patterns.
- Avoid unnecessary type assertions, broad `any` types, non-null assertions, and compiler suppressions.
- Never silence a compiler error without understanding its cause.
- Do not use `as any`, `@ts-ignore`, or `@ts-nocheck` merely to make a check pass.
- Do not remove meaningful tests or weaken assertions to conceal regressions.
- Do not rewrite unrelated sections for stylistic preference.

If a compile error reveals a broader pre-existing problem, determine whether it is in scope. Report unrelated issues separately rather than introducing a risky, unapproved refactor.

## 12. Testing and Validation

For implementation tasks, run the relevant validation commands available in the repository.

For TypeScript changes, run:

`npx tsc --noEmit`

Also run applicable tests, integration tests, build checks, linting, or targeted diagnostics when available and appropriate.

Before reporting completion:

1. Review the final diff.
2. Confirm all modified files are relevant to the task.
3. Check for unintended behavior changes and security regressions.
4. Validate affected interfaces, schemas, and callers.
5. Run the required checks where practical.
6. Record the actual command results.

Never:

- Claim a test passed if it was not run.
- Claim a build succeeded without verification.
- Claim an external provider integration works based only on TypeScript compilation.
- Hide failing tests or unrelated pre-existing compiler errors.
- Mark an incomplete implementation as complete.

If a check cannot be run, explain why and identify the unverified behavior.

## 13. Minimal-Diff Implementation Policy

Prefer focused, reviewable changes.

Do not:

- Rewrite entire files to change a small section.
- Perform unrelated refactoring.
- Duplicate existing logic instead of reusing it.
- Introduce dependencies without a demonstrated need.
- Rename files or public symbols without justification and approval where compatibility is affected.
- Reformat large sections unnecessarily.
- Change environment settings or production configuration as a side effect.
- Modify files outside the task's scope.

Preserve unrelated user changes. Never overwrite or discard existing work merely because it appears incomplete or inconsistent.

If the working tree contains uncommitted changes, inspect the relevant diff before editing and avoid interfering with those changes.

## 14. Approval Gates

Explicit project-owner approval is required before:

- Redesigning architectural boundaries.
- Replacing existing Core infrastructure or integration patterns.
- Introducing a parallel authentication, credential, AI, or provider architecture.
- Making breaking public API or canonical model changes.
- Removing working functionality or compatibility paths.
- Performing destructive database operations or materially risky migrations.
- Changing production secrets, permissions, or deployment configuration.
- Deploying to production or performing irreversible production operations.
- Broadening a task into a major refactor that was not requested.

If a requested task cannot be completed safely within the existing architecture, stop and explain:

1. The limitation.
2. The relevant files and architectural boundaries.
3. The available approaches.
4. The trade-offs and compatibility risks.
5. The specific decision or approval required.

Do not interpret silence as approval for a material architectural change.

Routine, localized implementation and its necessary tests may proceed when they remain within the established architecture and the user's requested scope.

## 15. Required Final Report

After each implementation task, provide a concise but evidence-based report covering:

### Summary
What changed and why.

### Files Changed
List the exact repository-relative file paths and the purpose of each change.

### Architecture and Compatibility
Explain how the change preserves the existing iPaaS structure, tenant boundaries, integration contracts, and existing functionality.

### Validation
List the commands and tests actually executed, with their real outcomes.

### Remaining Issues
Identify known limitations, unverified behavior, pre-existing failures relevant to the task, and follow-up work.

### Deployment Status
State explicitly whether any deployment or production operation was performed.

Do not overstate completion. If the implementation is partial, identify exactly what remains.

## 16. Default Working Mode

Unless the user explicitly requests a different workflow:

- Inspect first.
- Understand before editing.
- Explain substantial changes before implementing them.
- Reuse the existing architecture.
- Make focused changes.
- Test the affected behavior.
- Review the diff.
- Report the actual results.
- Preserve all unrelated work.

The priority order is:

1. Security and tenant isolation.
2. Architectural integrity.
3. Correctness and data integrity.
4. Backward compatibility.
5. Minimal, maintainable implementation.
6. Verified behavior and regression prevention.

**The ultimate rule: Improve FusionLab360 Core from within its existing generic iPaaS architecture. Do not compromise the platform's architecture to deliver an isolated feature or short-term fix.**
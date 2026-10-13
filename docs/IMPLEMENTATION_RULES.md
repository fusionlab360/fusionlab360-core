# FusionLab360 Core — Implementation Rules

## 1. Mandatory Workflow

Every implementation task must follow this workflow.

### Phase 1: Understand

- Read the root AGENTS.md and relevant architecture documentation.
- Understand the requested behavior and acceptance criteria.
- Inspect the existing implementation before proposing a solution.
- Identify callers, dependencies, interfaces, database schemas, migrations, and tests.
- Trace the complete execution path affected by the change.

### Phase 2: Diagnose

- Identify the root cause instead of treating only the visible symptom.
- Determine whether an existing service or extension point already solves the problem.
- Identify potential regressions and tenant-isolation risks.
- Distinguish verified facts from assumptions.
- Do not invent missing files, functions, APIs, tables, or provider capabilities.

### Phase 3: Plan

Before substantial changes, report:

1. Root cause or implementation gap.
2. Proposed solution.
3. Exact files expected to change.
4. Existing functionality that must remain unchanged.
5. Risks and backward-compatibility considerations.
6. Tests and acceptance criteria.

Keep the plan proportional to the task. Ask for approval before architectural redesigns or other restricted changes.

### Phase 4: Implement

- Make the smallest complete change that solves the problem.
- Follow existing naming, typing, dependency, and error-handling conventions.
- Reuse established services and interfaces.
- Avoid unrelated refactoring.
- Avoid duplicate implementations and unnecessary abstractions.
- Preserve tenant boundaries and provider credential handling.
- Update tests when behavior changes.
- Do not silently weaken validation or remove existing functionality to make tests pass.

### Phase 5: Validate

Run the most relevant tests and checks available.

For TypeScript changes, run:

`npx tsc --noEmit`

Also run relevant unit tests, integration tests, and build checks when available and appropriate.

If a check fails:

- Identify whether the failure was introduced by the change or already existed.
- Diagnose the actual cause.
- Fix regressions caused by the implementation.
- Do not claim success when validation remains incomplete.
- Report unrelated pre-existing failures separately.

### Phase 6: Review

Inspect the final diff.

Confirm that:

- Only necessary files changed.
- No unrelated behavior was modified.
- No secrets or credentials were exposed.
- No tenant-isolation safeguards were weakened.
- API and database compatibility were considered.
- Error handling, retries, and idempotency remain correct where required.
- Tests cover the relevant behavior.

### Phase 7: Report

Summarize:

1. What was implemented.
2. Why the change was needed.
3. Exact files changed.
4. Tests and commands executed.
5. Actual validation results.
6. Remaining limitations and risks.
7. Any follow-up work required.

## 2. Approval Gates

Explicit approval is required before:

- Redesigning architectural boundaries.
- Introducing a new architectural framework or competing subsystem.
- Making breaking public API or canonical model changes.
- Performing destructive or high-risk database migrations.
- Removing established functionality or compatibility paths.
- Changing production secrets, credentials, or deployment configuration.
- Deploying to production or performing irreversible production operations.

If a task cannot be completed safely within existing boundaries, stop and explain the conflict.

## 3. Database and Migration Safety

- Inspect existing migrations and schema before proposing changes.
- Follow the established migration naming and execution conventions.
- Never assume a table or column exists without checking.
- Preserve tenant ownership and data integrity.
- Consider existing production data and backward compatibility.
- Do not execute destructive migrations without approval.
- Do not modify production data merely to make local tests pass.

## 4. API and Integration Safety

- Follow existing authentication and tenant-resolution mechanisms.
- Reuse the established provider credential flow.
- Validate inbound data and external provider responses.
- Handle provider errors without exposing secrets.
- Preserve idempotency and safe retry semantics.
- Avoid changing request or response contracts without approval.
- Do not claim an external integration works based solely on successful compilation.

## 5. AI and Knowledge Retrieval Safety

- Inspect the existing AI execution flow before modifying it.
- Reuse established instruction, knowledge retrieval, context, and messaging services.
- Keep tenant-specific knowledge isolated.
- Distinguish retrieved evidence from unsupported assumptions.
- Prevent AI responses from inventing business policies, availability, prices, or completed actions.
- Require deterministic domain validation before executing business operations.
- Preserve human handoff and error-recovery behavior where implemented.
- Evaluate behavior using relevant regression tests rather than relying only on code inspection.

## 6. Prohibited Shortcuts

Never:

- Disable TypeScript checks to conceal errors.
- Add broad `any` types or unsafe casts merely to silence compiler errors.
- Remove failing tests instead of fixing the underlying defect.
- Duplicate functions to avoid understanding the existing implementation.
- Change unrelated files during a focused task.
- Claim tests passed when they were not executed.
- Claim a feature is complete when important paths remain unverified.
- Make architectural decisions on the assumption that the largest redesign is the best solution.

## 7. Completion Criteria

A task is complete only when:

- The requested behavior is implemented within approved architectural boundaries.
- Relevant tests and validation have been performed.
- Regressions have been considered.
- The final diff has been reviewed.
- Any outstanding failures and limitations are explicitly reported.

If completion criteria cannot be met, report the task as incomplete and explain why.

## 8. Add mandatory review requirements for:

Tenant scoping on every relevant read, update, and delete.

Cross-tenant authorization and regression tests.

Tenant-consistent relationships and schema constraints where appropriate and safely achievable.

Webhook signature verification for providers that support it.

OAuth state, callback validation, and credential lifecycle security where applicable.

Redacting secrets, tokens, personal data, and sensitive payloads from logs and errors.

Backward-compatible migrations and assessment of existing production data.

Require Codex to inspect the existing implementation before recommending security or schema changes. Do not automatically create migrations or change security flows.
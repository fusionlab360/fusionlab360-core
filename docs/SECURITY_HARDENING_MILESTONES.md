# Security Hardening Milestones

Updated 2026-11-09. Status is local to the consolidated Core candidate; no production operation was performed.

| Finding | Local status | Evidence and release dependency |
|---|---|---|
| F-01 — GHL credential storage | Implemented locally | GHL company and location credential writes use versioned AES-GCM envelopes bound to provider/account ownership. Legacy plaintext reads require an explicit compatibility binding. Bounded, compare-and-set migration methods are idempotent and tested. Production key provisioning and controlled data conversion remain unapproved and unrun. |
| F-02 — webhook body limits | Implemented locally | GHL inbound and provider-outbound routes use the shared 10 MiB bounded reader before buffering and verify signatures against raw bytes. Meta's existing bounded path remains intact. |
| F-03 — rate limiting | No production control change in this milestone | This release gap-closure task did not modify Cloudflare edge settings. Current visible Worker metadata is not evidence of the zone's complete rate-limit policy; verify edge controls through the approved Cloudflare operational review. |
| F-04 — CORS | Implemented locally | General browser CORS now requires exact configured origins; absent or invalid configuration fails closed. GHL webhook routes remain server-to-server, and the embedded page/verifier retain their existing origin checks. Production browser origins require explicit owner approval. |
| Error disclosure | Implemented locally | `ApiError.details` and exception messages are excluded from public responses and API-error logs. Responses retain safe status-based messages, allowlisted codes, and correlation IDs. |

Validation on the canonical branch: full Core suite 805/805 passed; `npx tsc --noEmit` passed. The release plan in `FL360_CORE_PRODUCTION_GAP_CLOSURE.md` contains current read-only production evidence and the blocked release sequence.

**Production status: BLOCKED.** The active Worker has no Core encryption keyring, production migration is not packaged or approved, exact browser origins are not recorded, and the current queue metadata does not expose backlog depth. No production keys, credentials, D1 rows, provider APIs, traffic, flags, or WABA candidates were changed.

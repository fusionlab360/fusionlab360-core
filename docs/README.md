# FusionLab360 Core documentation

Use the operating runbooks for current work. Audit, milestone, and release
records describe the repository and deployment at their recorded dates.
Confirm live state before acting on a historical observation.

| Area | Start here |
|---|---|
| Engineering | [Repository rules](../AGENTS.md), [architecture](ARCHITECTURE.md), [implementation rules](IMPLEMENTATION_RULES.md), [project structure](FL360_PROJECT_STRUCTURE.md) |
| Credentials and access | [GHL encryption rollout](GHL_CREDENTIAL_ENCRYPTION_RUNBOOK.md), [GHL location ownership](GHL_LOCATION_OWNERSHIP.md), [API client permissions](API_CLIENT_PERMISSIONS.md) |
| D1 and recovery | [Schema inventory](D1_SCHEMA_INVENTORY.md), [production schema comparison](D1_PRODUCTION_SCHEMA_DIFF.md), [runtime usage](D1_RUNTIME_USAGE_MATRIX.md), [legacy candidates](D1_LEGACY_CANDIDATES.md) |
| WhatsApp | [Developer control plane](WABA_DEVELOPER_CONTROL_PLANE.md), [Meta readiness checks](META_WHATSAPP_PRODUCTION_READINESS_CHECKLIST.md), [lifecycle migration compatibility](WABA_0042_COMPATIBILITY.md), [GM Metro pilot evidence](WABA_GMMETRO_TEST_PILOT_EVIDENCE.md) |
| Release and preservation | [Source and release register](FL360_RELEASE_SOURCE_REGISTER.md), [cleanup inventory](CORE_SECURITY_P01_CLEANUP_INVENTORY.md), [earlier cleanup decisions](FL360_CLEANUP_REGISTER.md), [M1 release candidate](../release/M1_RELEASE_CANDIDATE.md) |

The [security milestones](SECURITY_HARDENING_MILESTONES.md) and
[production gap closure](FL360_CORE_PRODUCTION_GAP_CLOSURE.md) overlap on
credential readiness. Use the GHL encryption runbook for the current
conversion procedure and keep those documents as evidence of earlier
decisions. The [WABA audit](WABA_PRODUCTION_READINESS_AUDIT.md),
[roadmap](WABA_PRODUCTION_ROADMAP.md), and
[milestones](WABA_MASTER_MILESTONES.md) distinguish observed gaps,
planned work, and local progress. The
[P04 release record](WABA_P04_PRODUCTION_READONLY_RELEASE.md) describes a
specific candidate.

The [consolidation decision](CORE_CONSOLIDATION_FINAL.md),
[reconciliation evidence](CORE_CONSOLIDATION_RECONCILIATION.md), and
[historical reports index](reports/historical/core-consolidation-20261024/README.md)
retain distinct source and release evidence. Earlier platform assessments
are in [the audit](reports/ipaas-full-audit-2026-10-19.md),
[risk register](reports/ipaas-risk-register-2026-10-19.md), and
[acceptance matrix](reports/integration-acceptance-matrix-2026-10-16.md).

STAAH mock integration history:
[M1](STAAH_M1.md), [M2](STAAH_M2.md), [M3](STAAH_M3.md),
[M4](STAAH_M4.md), [M5](STAAH_M5.md), [M6.1B](STAAH_GHL_M6_1B.md).
See the [AI auto-reply deprecation record](AI_AUTO_REPLY_DEPRECATION.md)
for the consolidated tenant control.

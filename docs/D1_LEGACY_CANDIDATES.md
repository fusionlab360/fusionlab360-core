# D1 Legacy Candidates

Date: 2026-10-24

This is an investigation list only. No object is dropped, renamed or rewritten.

| Object/group | Reason for review | Current decision |
|---|---|---|
| `reservation_links_collision_backup_20260824` | Historical backup table outside migration source | Retain; deletion requires separate evidence and approval |
| `reservation_links_legacy_crm_backup_20260824` | Historical backup table outside migration source | Retain; deletion requires separate evidence and approval |
| `reset_backup_integration_events_20260824` | Historical reset backup table | Retain; inspect provenance before any cleanup |
| `reset_backup_reservation_links_20260824` | Historical reset backup table | Retain; inspect provenance before any cleanup |
| `reset_backup_reservation_records_20260824` | Historical reset backup table | Retain; inspect provenance before any cleanup |
| `gohighlevel_oauth_installations` historical schema | Superseded by `oauth_installations` migration | Not present as a live table; historical migration remains permanent |
| Meta and canonical messaging tables | Absent in production but referenced by current code | Not legacy; required for the current release |
| Console service tables | Absent in production but referenced by current code | Not legacy; required for Console contracts |
| FTS5 internal tables | Managed derived search structures | Active compatibility objects; never drop |

No legacy candidate is safe to remove based on this audit alone.

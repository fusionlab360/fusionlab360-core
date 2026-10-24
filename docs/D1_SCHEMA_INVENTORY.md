# D1 Schema Inventory

Date: 2026-10-24

## Scope and evidence

- Source directory: `migrations/` in canonical Core.
- Migration files discovered: **41** (including two distinct `0023` files).
- Production database: `fusionlab360-db` (`e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4`).
- Production tracker before any change: applied through `0027`; `0028`–`0041` pending.
- Full SQL export was not used because production contains FTS5 virtual tables.
- All production queries in this audit were read-only and aggregate/redacted.

## Migration inventory

| File | SHA-256 | Main effect | Production status | Populated-data risk |
|---|---|---|---|---|
| 0001_create_tenants.sql | AB825FA3…FA10A | Creates `tenants` | Applied | Low |
| 0002_create_clients.sql | 8647E7D4…34BB | Creates `clients` and indexes | Applied | Low |
| 0003_create_integrations.sql | 1463AB83…CFF2A | Creates `integrations` and indexes | Applied | Low |
| 0004_create_integration_credentials.sql | CEF4F387…8672C | Creates provider credential table | Applied | Credential compatibility |
| 0005_seed_fusionlab360.sql | DEE95C63…4D92 | Seeds initial tenant/client/integration/credential | Applied | Seed is historical |
| 0006_reservation_links.sql | 0946F649…B804 | Creates reservation links | Applied | Low |
| 0007_reservation_link_identity.sql | F12449C6…DD052 | Adds canonical reservation identity fields | Applied | Table rebuild/compatibility |
| 0008_integration_events.sql | 42EB6773…B1AA | Creates durable integration events | Applied | Active event data |
| 0009_integration_event_revision.sql | 094C798B…A92E2 | Adds event revision | Applied | Active event data |
| 0010_integration_event_dead_letters.sql | 5E07B77F…D206 | Creates event dead-letter table | Applied | Active recovery data |
| 0011_reservation_records.sql | 932B78F3…7026E | Creates reservation records | Applied | 1,749 live rows |
| 0012_reservation_link_crm_nullable.sql | 4DAF5B42…5E743 | Rebuilds reservation links with nullable CRM IDs | Applied | Table rebuild |
| 0013_ai_conversation_sessions.sql | 4F9A15B4…8CB09 | Creates AI conversation sessions | Applied | 395 live rows |
| 0014_ai_agent_profiles.sql | 8F7C36EA…87AD6 | Creates tenant AI profiles | Applied | 3 live rows |
| 0015_gohighlevel_oauth_installations.sql | F95AF4E8…1D4A88 | Creates legacy GHL OAuth table | Applied | Superseded table history |
| 0016_oauth_installations.sql | 97BE3524…C18C5 | Rebuilds OAuth installations | Applied | Existing OAuth row |
| 0017_create_knowledge_sources.sql | AC63DE44…C3BF | Creates knowledge sources | Applied | 8 live rows |
| 0018_create_knowledge_documents.sql | 127DFE43…2B7A | Creates knowledge documents | Applied | 83 live rows |
| 0019_ai_conversation_sessions_handoff_pending.sql | 8FB1A21F…8569A | Rebuilds AI sessions for handoff state | Applied | Table rebuild |
| 0020_ai_booking_sessions.sql | 5CC7AA9E…7E443C | Creates booking sessions | Applied | 22 live rows |
| 0021_integration_credential_auth_lifecycle.sql | 2B041868…709C81 | Adds credential auth/lifecycle fields and backfills | Applied | Credential lifecycle |
| 0022_ai_agent_profile_instructions.sql | 558B997A…06D19 | Adds AI instructions | Applied | AI behavior |
| 0023_integration_event_processing.sql | 584331D7…6FB45 | Adds processing state and index | Applied | 7,227 live events |
| 0023_knowledge_documents_fts.sql | 1DAA9E01…53DA | Creates/rebuilds FTS5 tables and triggers | Applied | FTS recovery/export limitation |
| 0024_create_tenant_feature_settings.sql | B88AC6D3…55627 | Creates feature settings | Applied | 6 live rows |
| 0025_durable_inbound_processing.sql | 38901638…628E7A | Adds leases/idempotency and outbound delivery table | Applied | 154 live deliveries |
| 0026_create_oauth_authorization_states.sql | 5EE381B5…08F8FF | Creates OAuth state table | Applied | 0 live rows |
| 0027_enforce_ghl_location_ownership.sql | 60A98B46…56CEC0 | Adds unique normalized GHL Location ownership index | Applied; index verified | Low after duplicate preflight |
| 0028_reservation_provider_connection_identity.sql | 4EBB76FA…7CA735 | Adds nullable provider connection/property fields and partial unique index | **Pending** | 1,749-row table alteration |
| 0029_meta_whatsapp_connections.sql | 50F01BC1…2FC578 | Creates Meta connection table | **Pending** | New schema |
| 0030_meta_whatsapp_credential_security.sql | 7A981EC8…08CDF | Creates encrypted Meta credential table and ownership triggers | **Pending** | New triggers/credentials |
| 0031_messaging_conversations.sql | 1B64FCD6…C774 | Creates canonical conversation/message tables | **Pending** | New schema |
| 0032_meta_whatsapp_outbound.sql | B8AAFBE1…545F9 | Adds outbound Meta fields/index | **Pending** | Depends on 0025/0031 |
| 0033_meta_whatsapp_delivery_status.sql | E9862769…4549AD | Adds delivery status/index | **Pending** | Depends on 0032 |
| 0034_messaging_outbound_messages.sql | E3B7C64B…99B66 | Links canonical messages to outbound deliveries | **Pending** | Depends on 0031/0032 |
| 0035_provider_neutral_messaging_connections.sql | 23A8E81D…6FB2BB | Rebuilds messaging connections/conversations/messages | **Pending** | Transaction wrapper and table rebuild |
| 0036_console_users_and_memberships.sql | F0641399…E79D45 | Creates Core console user/membership tables | **Pending** | Runtime-consumed schema |
| 0037_console_service_contract.sql | 811B5BF2…624A2 | Creates service idempotency and tenant grants | **Pending** | Authorization data |
| 0038_console_service_identity.sql | 2EFBC649…54F244 | Creates dedicated Console service identity marker | **Pending** | Authorization data |
| 0039_console_messaging_send_grants.sql | B428AE6B…66735 | Rebuilds grants to add `messaging:send` | **Pending** | Table rebuild/permission preservation |
| 0040_tenant_ai_auto_reply.sql | F53D1F00…D26B | Inserts `ai_auto_reply=1` for missing rows | **Pending** | **Unsafe without prior OFF initialization** |
| 0041_console_feature_grants.sql | FEAC7635…330F1 | Rebuilds grants to add feature scopes | **Pending** | Table rebuild/permission preservation |

Hashes are shown with an abbreviated suffix for readability; the complete hashes were captured from `Get-FileHash` during this audit.

## Production object evidence

Production contains the pre-0028 schema, FTS5 virtual tables/triggers, additional historical backup tables, and no post-0028 messaging, Meta, Console-service or grant-rebuild objects. The production migration tracker remains the authoritative applied-state record; no history rows were modified.

## Complete SHA-256 manifest

```text
0001_create_tenants.sql AB825FA353E36180DF671F47EA3C7B0D74EE8F41539A21CC329B183C7C9FA10A
0002_create_clients.sql 8647E7D404DF09EF2AB241558B427BDD953FDA7A2545961252739B3509E134BB
0003_create_integrations.sql 1463AB832D75C8965C504C6AA5D67B1C066809DC8FF0997DAB39D267FF9CFF2A
0004_create_integration_credentials.sql CEF4F38723F86C59350619EB0F2B71332729F4E6DC376E5273436FAE1768672C
0005_seed_fusionlab360.sql DEE95C63AD4D97BC8FC5A38EFD2066E85E1CF7C0C29F7FE50554DFADDF574D92
0006_reservation_links.sql 0946F64999E267318C8000FB8CD3B1C554B225231870C332FB5D1B8495EB8B04
0007_reservation_link_identity.sql F12449C6E6971B2848DC065CC2ED2F63303DA9CBBC2A974D49762C657CDDD052
0008_integration_events.sql 42EB67731D51C1F8488A422785C44F926C197A9CE8B1C2605AB5F47E8CC2B1AA
0009_integration_event_revision.sql 094C798B6A757EAB5E9C76B6965B8A1F22512DF264FF57A93C2B028335EA92E2
0010_integration_event_dead_letters.sql 5E07B77F14E2F30C28DB2713D38DEED2CADAD692FD3B5E410D03EC1FCD1D206F
0011_reservation_records.sql 932B78F315D6B5026685DE594847D6985612917445C296452DD05FF582C7026E
0012_reservation_link_crm_nullable.sql 4DAF5B422D59630C134B53B3B62AA658FA2F08D0DA9E15EA13DF074F3B35E743
0013_ai_conversation_sessions.sql 4F9A15B47D4623D5A3B71F6B570E493904026ED85CDAB845D89363470BC8CB09
0014_ai_agent_profiles.sql 8F7C36EAC4CFCE85F0E7551761341E80E95BE47DDC6A54DDBA0C0449748D7AD6
0015_gohighlevel_oauth_installations.sql F95AF4E8DE65481F173806ED150C924E95A2072F71E4BE9A17C3CA46A81D4A88
0016_oauth_installations.sql 97BE352435A5028F64F20037DC07EFDE8F5013BA43B012818FBCD1F9BC7C18C5
0017_create_knowledge_sources.sql AC63DE448C9AEBE29BC6A5F2ACACF9C9DAA65E4156A0CA021C4DDEC8F4A6C3BF
0018_create_knowledge_documents.sql 127DFE436E2E84B7EFBF97424AC449DF02D96267EF24F1B023B95747DD3A2B7A
0019_ai_conversation_sessions_handoff_pending.sql 8FB1A21F190CE32F3FAE3E2A4406F42986218545A02C42520490566213C8569A
0020_ai_booking_sessions.sql 5CC7AA9E1CF2560554801A9D6F9904366ABBFA4A4EF0173AA43C3503DF7E443C
0021_integration_credential_auth_lifecycle.sql 2B0418687C505ECEC2EC8848623D47A7E422B9A51C8249A7B81F92B849709C81
0022_ai_agent_profile_instructions.sql 558B997AA68EB13036046E91D8257C06E169CF60FC46AD8C9D48686A80F06D19
0023_integration_event_processing.sql 584331D7939FE309C103AAABAC776C7A1BC6A145D0E3B35D446413827F06FB45
0023_knowledge_documents_fts.sql 1DAA9E018F74381A0EC74025B7BF05BA415260796B0F40238998DA1B96D253DA
0024_create_tenant_feature_settings.sql B88AC6D3D83D99EC604987411B4BEF17E37A78F365B2B0B39B0ECC01EA55627A
0025_durable_inbound_processing.sql 389016386E0C3776B8A2F95710E0ECFA19BA8CDF9D5073B2B39F5EAE0F628E7A
0026_create_oauth_authorization_states.sql 5EE381B595703AB674F3CA1E86CAD580CFF24F8FDC5EE89EC07D0FBE4D08F8FF
0027_enforce_ghl_location_ownership.sql 60A98B465926C453893E61A194D11BC9E184F8E14EFAAC02F5308A218056CEC0
0028_reservation_provider_connection_identity.sql 4EBB76FA9F4BBF30762C7DB2105899826B7D9FE57B31081F9470A056D77CA735
0029_meta_whatsapp_connections.sql 50F01BC1246B22E1F4CC0C6D766E2D53BE3DDE5C92DAA4E8495D0E70CF2FC578
0030_meta_whatsapp_credential_security.sql 7A981EC81E51F2D67FB924944115FA63FA764644A64124C57DA31D813DC08CDF
0031_messaging_conversations.sql 1B64FCD67623D1E75E788FAD46E0711EA2B4479D1641C8E4A57FAAF9C6CDC774
0032_meta_whatsapp_outbound.sql B8AAFBE13FCA83C19FB9FDE4075F9161B2C956EAFEB5EE7423A0FF9095B454F9
0033_meta_whatsapp_delivery_status.sql E98627693FF7EB68686CFA26B929AAA2DE31AEA9ABAB22072298DED73C4549AD
0034_messaging_outbound_messages.sql E3B7C64B82B3582F6BE14517CC95EA9914A2C9A02C0CA7405F4551F7DB699B66
0035_provider_neutral_messaging_connections.sql 23A8E81D3A21014D79BB8D199BDA0E7502F4E6E5C279BB3F0DA9B8E4D86FB2BB
0036_console_users_and_memberships.sql F06413993CDF411914FBF7B73DB614D09D8B077A69E575120A8AD1CBD7E79D45
0037_console_service_contract.sql 811B5BF296362E9E30D2A4A6481F8276BD79317EB571B55CB21EE858CBF624A2
0038_console_service_identity.sql 2EFBC649C863E0A45DF220846AF053C77DF63CA29304C9D61CE85D1C9D54F244
0039_console_messaging_send_grants.sql B428AE6B7E6E49ED7130209D29D357B6B30DDC2CA344DFA15191033099B66735
0040_tenant_ai_auto_reply.sql F53D1F006BB8F0049077876A919EA05AF226C16AF27D7C719BBDAFDD1170D26B
0041_console_feature_grants.sql FEAC76359EF195178013289501D0B4733FF303D3646574B3819EE920187330F1
```

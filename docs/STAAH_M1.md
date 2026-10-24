# STAAH M1 Provider Foundation

> This document records the M1 baseline. M2 and M3 extensions are documented in
> [`STAAH_M2.md`](STAAH_M2.md) and [`STAAH_M3.md`](STAAH_M3.md); the later
> milestones supersede the M1-only capability statements below.

## Current implementation

STAAH is represented by the provider key `staah`, display name `STAAH`, and
category `channel_manager`. Its module starts in mock mode. It has no persistent
connection provisioning, no credentials, no live implementation, and no
downstream reservation synchronization. Creating or importing the provider
module does not insert tenant or integration records.

The mock resolver expects tenant, integration, and connection identifiers from
the trusted internal resolution path. It validates that they are non-empty and
binds an adapter instance to those values; it is not itself an authentication
or tenant-authorization mechanism. Calls with a mismatched context are rejected.
Mock verification returns `mock_verified`; this confirms only that the local
mock configuration is valid. It does not establish STAAH authentication, a
property relationship, or an authorized live connection.

Mock mode accepts the `crm` API profile only. `channelconnect_v2`, `rms`, and
`metachannel` are represented as distinct profile identifiers and rejected as
unsupported in M1. Selecting `live` fails closed. The mock contains no HTTP
client and does not read GoHighLevel credentials or tenant CRM configuration.

The Core integration table already stores a provider key as text, tenant/provider
integration settings as JSON, and credentials under a tenant/provider key. The
STAAH mock foundation therefore requires no D1 migration. Current tenant
resolution still models a GHL CRM and a separate browser/PMS slot; it does not
load STAAH as a tenant integration. The descriptor is provider-local because
Core currently has no shared provider catalog or channel-manager resolver. M1
does not create that broader catalog or auto-create tenant connections.

## Official profile distinctions reviewed

The official [STAAH CRM API documentation](https://crmapidoc.staah.net/) describes
booking pull/push and property status operations. Its pull-booking contract
describes a partner authentication header and a property code, with the
production endpoint supplied by STAAH.

The official [ChannelConnect V2 documentation](https://getapidoc.staah.net/v2/)
describes a separate channel integration, using provider-supplied service and
booking endpoints and a different request/authentication contract. The official
[RMS documentation](https://rmsdoc.staah.net/) describes an RMS integration for
availability, rates, and restrictions. The official
[Metachannel V2 documentation](https://metachanneldoc.staah.net/version2/)
describes a separate API for property and room/rate information, rates,
availability, restrictions, and push data.

No API calls were made. These documents do not establish that this project has
partner credentials, an agreement, an approved endpoint, or property access.
The mock result shapes in code are internal synthetic contracts, not official
STAAH response fixtures.

## M2 continuation

Persistent tenant-scoped mock connection management is documented in
[`STAAH_M2.md`](STAAH_M2.md). It continues to use this adapter and does not add
live STAAH connectivity, credentials, or synchronization.

After STAAH approves the partnership and provides the exact CRM profile
credentials/endpoints, implement contract-verified CRM connection and
reservation retrieval behind the provider module. Keep live mode disabled until
credentials, endpoint ownership, error semantics, and an approved test property
are confirmed. Property and room/rate catalogs should be added only when a
chosen STAAH profile and the Core canonical domain contract are agreed.

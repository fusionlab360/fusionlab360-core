-- Allow Core reservation identity to exist before
-- CRM contact/opportunity reconciliation.

CREATE TABLE reservation_links_new (

    tenant_id TEXT NOT NULL,

    reservation_id TEXT NOT NULL,

    contact_id TEXT,

    opportunity_id TEXT,

    lifecycle TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    canonical_reservation_id TEXT,

    provider TEXT,

    provider_reservation_id TEXT,

    provider_calendar_id TEXT,

    provider_edit_id TEXT,

    revision INTEGER,

    last_event_id TEXT,

    PRIMARY KEY (
        tenant_id,
        reservation_id
    )

);

INSERT INTO reservation_links_new (
    tenant_id,
    reservation_id,
    contact_id,
    opportunity_id,
    lifecycle,
    created_at,
    updated_at,
    canonical_reservation_id,
    provider,
    provider_reservation_id,
    provider_calendar_id,
    provider_edit_id,
    revision,
    last_event_id
)
SELECT
    tenant_id,
    reservation_id,
    contact_id,
    opportunity_id,
    lifecycle,
    created_at,
    updated_at,
    canonical_reservation_id,
    provider,
    provider_reservation_id,
    provider_calendar_id,
    provider_edit_id,
    revision,
    last_event_id
FROM reservation_links;

DROP TABLE reservation_links;

ALTER TABLE reservation_links_new
RENAME TO reservation_links;

CREATE INDEX idx_reservation_links_opportunity
ON reservation_links(opportunity_id);
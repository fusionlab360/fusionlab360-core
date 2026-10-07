CREATE TABLE reservation_links (

    tenant_id TEXT NOT NULL,

    reservation_id TEXT NOT NULL,

    contact_id TEXT NOT NULL,

    opportunity_id TEXT NOT NULL,

    lifecycle TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (
        tenant_id,
        reservation_id
    )
);

CREATE INDEX idx_reservation_links_opportunity
ON reservation_links(opportunity_id);
CREATE TABLE reservation_records (

    tenant_id TEXT NOT NULL,

    canonical_reservation_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    provider_reservation_id TEXT NOT NULL,

    provider_calendar_id TEXT,

    provider_edit_id TEXT,

    revision INTEGER NOT NULL DEFAULT 0,

    lifecycle TEXT NOT NULL,

    payload TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (
        tenant_id,
        canonical_reservation_id
    )

);
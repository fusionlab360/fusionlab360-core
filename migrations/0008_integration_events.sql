CREATE TABLE integration_events (

    event_id TEXT NOT NULL,

    tenant_id TEXT NOT NULL,

    event_type TEXT NOT NULL,

    aggregate_type TEXT NOT NULL,

    aggregate_id TEXT NOT NULL,

    provider TEXT,

    occurred_at TEXT NOT NULL,

    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    payload TEXT NOT NULL,

    PRIMARY KEY (
        event_id
    )

);
CREATE TABLE ai_booking_sessions (
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    conversation_id TEXT NOT NULL,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'collecting',
                'awaiting_slot_selection',
                'awaiting_confirmation',
                'confirmed',
                'cancelled'
            )
        ),

    booking_type TEXT NOT NULL
        CHECK (
            booking_type IN (
                'appointment',
                'accommodation'
            )
        ),

    offering_id TEXT,

    resource_id TEXT,

    start_at TEXT,

    end_at TEXT,

    adults INTEGER,

    children INTEGER,

    quantity INTEGER,

    pending_slots_json TEXT,

    data_json TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (
        tenant_id,
        provider,
        conversation_id
    )
);

CREATE INDEX idx_ai_booking_sessions_tenant
ON ai_booking_sessions (
    tenant_id
);

CREATE INDEX idx_ai_booking_sessions_status
ON ai_booking_sessions (
    status
);
CREATE TABLE ai_conversation_sessions (
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    conversation_id TEXT NOT NULL,

    state TEXT NOT NULL
        CHECK (
            state IN (
                'awaiting_choice',
                'ai_active',
                'human_handoff'
            )
        ),

    session_started_at TEXT NOT NULL,

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

CREATE INDEX idx_ai_sessions_tenant
ON ai_conversation_sessions(
    tenant_id
);

CREATE INDEX idx_ai_sessions_state
ON ai_conversation_sessions(
    state
);
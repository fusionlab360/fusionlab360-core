CREATE TABLE ai_conversation_sessions_new (
    tenant_id TEXT NOT NULL,

    provider TEXT NOT NULL,

    conversation_id TEXT NOT NULL,

    state TEXT NOT NULL
        CHECK (
            state IN (
                'awaiting_choice',
                'ai_active',
                'handoff_pending',
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

INSERT INTO ai_conversation_sessions_new (
    tenant_id,
    provider,
    conversation_id,
    state,
    session_started_at,
    created_at,
    updated_at
)
SELECT
    tenant_id,
    provider,
    conversation_id,
    state,
    session_started_at,
    created_at,
    updated_at
FROM ai_conversation_sessions;

DROP TABLE ai_conversation_sessions;

ALTER TABLE
    ai_conversation_sessions_new
RENAME TO
    ai_conversation_sessions;

CREATE INDEX idx_ai_sessions_tenant
ON ai_conversation_sessions(
    tenant_id
);

CREATE INDEX idx_ai_sessions_state
ON ai_conversation_sessions(
    state
);
CREATE TABLE ai_agent_profiles (
    tenant_id TEXT PRIMARY KEY,

    agent_name TEXT NOT NULL,

    business_name TEXT NOT NULL,

    business_type TEXT NOT NULL,

    greeting_template TEXT NOT NULL,

    handoff_template TEXT NOT NULL,

    system_instructions TEXT NOT NULL,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);
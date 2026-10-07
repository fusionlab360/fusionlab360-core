CREATE TABLE integration_event_dead_letters (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    event_id TEXT NOT NULL,

    tenant_id TEXT NOT NULL,

    error_code TEXT NOT NULL,

    error_message TEXT NOT NULL,

    retryable INTEGER NOT NULL DEFAULT 0,

    attempts INTEGER NOT NULL DEFAULT 0,

    payload TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

);
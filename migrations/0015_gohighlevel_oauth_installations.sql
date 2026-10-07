CREATE TABLE gohighlevel_oauth_installations (
    company_id TEXT PRIMARY KEY,

    access_token TEXT NOT NULL,

    refresh_token TEXT,

    user_id TEXT,

    metadata TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);
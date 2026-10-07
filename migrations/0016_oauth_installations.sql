CREATE TABLE oauth_installations (
    provider TEXT NOT NULL,

    account_type TEXT NOT NULL,

    external_account_id TEXT NOT NULL,

    external_user_id TEXT,

    access_token TEXT NOT NULL,

    refresh_token TEXT,

    metadata TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (
        provider,
        account_type,
        external_account_id
    )
);


INSERT INTO oauth_installations (
    provider,
    account_type,
    external_account_id,
    external_user_id,
    access_token,
    refresh_token,
    metadata,
    created_at,
    updated_at
)
SELECT
    'gohighlevel',
    'company',
    company_id,
    user_id,
    access_token,
    refresh_token,
    metadata,
    created_at,
    updated_at
FROM gohighlevel_oauth_installations;


DROP TABLE gohighlevel_oauth_installations;
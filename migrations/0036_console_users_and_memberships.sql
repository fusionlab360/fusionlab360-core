-- Local console foundation: human identities and tenant memberships.
-- This migration does not create integrations, credentials, or provider links.
CREATE TABLE console_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  platform_role TEXT NOT NULL DEFAULT 'none'
    CHECK (platform_role IN ('none', 'platform_admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE console_memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('company_admin', 'company_manager', 'company_agent', 'company_viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id) REFERENCES console_users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_console_memberships_tenant
  ON console_memberships (tenant_id, status);
CREATE INDEX idx_console_memberships_user
  ON console_memberships (user_id, status);

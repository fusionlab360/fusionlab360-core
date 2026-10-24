import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("historical migration 0040 preserves explicit auto-reply states and defaults missing state off", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE tenant_feature_settings (
      tenant_id TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, feature_key)
    );
  `);
  db.exec(`INSERT INTO tenants (id, name) VALUES
    ('explicit-on', 'Explicit On'),
    ('explicit-off', 'Explicit Off'),
    ('unknown', 'Unknown'),
    ('new-tenant', 'New Tenant');`);
  db.exec(`INSERT INTO tenant_feature_settings (tenant_id, feature_key, enabled)
    VALUES ('explicit-on', 'ai_auto_reply', 1),
           ('explicit-off', 'ai_auto_reply', 0);`);

  const migration = readFileSync(
    join(process.cwd(), "migrations", "0040_tenant_ai_auto_reply.sql"),
    "utf8",
  );
  db.exec(migration);

  const rows = db
    .prepare(
      `SELECT tenant_id, enabled
       FROM tenant_feature_settings
       WHERE feature_key = 'ai_auto_reply'
       ORDER BY tenant_id`,
    )
    .all()
    .map((row) => ({
      tenant_id: String((row as { tenant_id: string }).tenant_id),
      enabled: Number((row as { enabled: number }).enabled),
    }));

  assert.deepEqual(rows, [
    { tenant_id: "explicit-off", enabled: 0 },
    { tenant_id: "explicit-on", enabled: 1 },
    { tenant_id: "new-tenant", enabled: 0 },
    { tenant_id: "unknown", enabled: 0 },
  ]);
  assert.equal(
    rows.filter((row) => row.enabled === 1).length,
    1,
    "migration must not activate tenants without explicit ON state",
  );
});

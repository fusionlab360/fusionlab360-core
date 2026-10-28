import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { inspectServiceClient, provisionServiceClient } from "../../../src/cli/services/service-client-provisioner";
import { parseServiceClientArguments } from "../../../src/cli/commands/service-client";

class LocalD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => this.sqlite.prepare(sql).get(...values as never[]) as T | undefined ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      for (const statement of statements as Array<{ run: () => Promise<unknown> }>) await statement.run();
      this.sqlite.exec("COMMIT");
      return [];
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  binding(): D1Database { return this as unknown as D1Database; }
}

function seed(db: LocalD1) {
  db.sqlite.exec("INSERT INTO tenants(id,name,status) VALUES ('gmmetro','Gmmetro','active');");
}

const input = {
  tenantId: "gmmetro",
  clientId: "gmmetro-headless-operator",
  clientName: "gmmetro headless operator",
  operatorIdentity: "operator-approval-1",
};

test("service-client parser requires explicit production targeting and confirmation", () => {
  const parsed = parseServiceClientArguments([
    "provision", "--tenant", "gmmetro", "--client", input.clientId,
    "--name", input.clientName, "--operator", input.operatorIdentity,
    "--target", "production", "--remote",
    "--confirm", `PRODUCTION_SERVICE_CLIENT/gmmetro/${input.clientId}/${input.operatorIdentity}`,
  ]);
  assert.equal(parsed.action, "provision");
  assert.throws(() => parseServiceClientArguments(["provision", "--tenant", "gmmetro", "--client", input.clientId, "--target", "production", "--remote"]), /confirmation/);
  assert.throws(() => parseServiceClientArguments(["provision", "--tenant", "other", "--client", input.clientId, "--name", "x", "--operator", "op", "--target", "production", "--remote", "--confirm", "x"]), /approved gmmetro/);
});

test("service-client provisioning atomically creates least-privilege identity and grant", async () => {
  const db = new LocalD1();
  seed(db);
  try {
    const result = await provisionServiceClient(db.binding(), input, () => "fl360_test_generated_key_123456789");
    assert.equal(result.apiKey, "fl360_test_generated_key_123456789");
    const verified = await inspectServiceClient(db.binding(), "gmmetro", input.clientId);
    assert.deepEqual(verified, {
      tenantId: "gmmetro",
      clientId: input.clientId,
      status: "active",
      permissions: ["contacts:read", "integrations:test"],
      serviceMarker: true,
      contactsReadGrant: true,
    });
    const stored = db.sqlite.prepare("SELECT api_key_hash, permissions FROM clients WHERE id=?").get(input.clientId) as { api_key_hash: string; permissions: string };
    assert.notEqual(stored.api_key_hash, result.apiKey);
    assert.equal(stored.permissions.includes("*"), false);
  } finally {
    db.sqlite.close();
  }
});

test("service-client provisioning rejects an existing identity without changing it", async () => {
  const db = new LocalD1();
  seed(db);
  db.sqlite.exec(`INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES ('${input.clientId}','gmmetro','Existing','hash','active','["contacts:read"]');`);
  try {
    await assert.rejects(provisionServiceClient(db.binding(), input, () => "fl360_test_generated_key_123456789"), /already exists/);
    const row = db.sqlite.prepare("SELECT name, permissions FROM clients WHERE id=?").get(input.clientId) as { name: string; permissions: string };
    assert.equal(row.name, "Existing");
    assert.equal(row.permissions, "[\"contacts:read\"]");
  } finally {
    db.sqlite.close();
  }
});

test("service-client provisioning rolls back all records on a batch failure", async () => {
  const db = new LocalD1();
  seed(db);
  db.sqlite.exec("CREATE TRIGGER fail_service_marker BEFORE INSERT ON console_service_clients BEGIN SELECT RAISE(ABORT, 'synthetic marker failure'); END;");
  try {
    await assert.rejects(provisionServiceClient(db.binding(), input, () => "fl360_test_generated_key_123456789"), /synthetic marker failure/);
    assert.equal((db.sqlite.prepare("SELECT COUNT(*) AS count FROM clients WHERE id=?").get(input.clientId) as { count: number }).count, 0);
    assert.equal((db.sqlite.prepare("SELECT COUNT(*) AS count FROM client_tenant_grants WHERE client_id=?").get(input.clientId) as { count: number }).count, 0);
  } finally {
    db.sqlite.close();
  }
});

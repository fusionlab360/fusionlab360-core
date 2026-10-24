import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import routes from "../../../src/domain/console-service/routes";
import { hashApiKey } from "../../../src/core/security/api-key";

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
  binding(): D1Database { return this as unknown as D1Database; }
}

async function fixture(): Promise<{ db: LocalD1; key: string }> {
  const db = new LocalD1();
  const key = "fl360_dashboard_controls_test_key";
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES ('tenant-a','Synthetic A','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('integration-a','tenant-a','gohighlevel',1);
    INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id) VALUES ('tenant-a','gohighlevel','api_key','synthetic-ghl-token','location-a');
    INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES ('console-client','tenant-a','Console','${await hashApiKey(key)}','active','["messaging:read","messaging:send","features:read","features:write"]');
    INSERT INTO console_service_clients(client_id) VALUES ('console-client');
    INSERT INTO console_service_idempotency(client_id,idempotency_key,request_hash,tenant_id,tenant_name) VALUES ('console-client','bootstrap','hash','tenant-a','Synthetic A');
    INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','tenant-a','messaging:read');
    INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','tenant-a','messaging:send');
    INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','tenant-a','features:read');
    INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','tenant-a','features:write');
  `);
  return { db, key };
}

function app() { const application = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>(); application.route("/internal/console", routes); return application; }
function env(db: LocalD1): AppBindings { return { DB: db.binding(), GHL_OAUTH_CLIENT_ID: "synthetic-client", GHL_OAUTH_CLIENT_SECRET: "synthetic-secret" } as AppBindings; }

test("conversation contact is resolved by verified provider contact ID", async () => {
  const { db, key } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/conversations/search")) return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", locationId: "location-a" }] }), { status: 200 });
    if (url.includes("/contacts/")) return new Response(JSON.stringify({ contact: { id: "contact-a", firstName: "Ada", lastName: "Example", email: "ada@example.test", phone: "+60123456789", tags: ["vip"] } }), { status: 200 });
    throw new Error(`Unexpected synthetic URL: ${url}`);
  };
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/contact", { headers: { Authorization: `Bearer ${key}` } }, env(db));
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json() as { contact: { id: string; email?: string } }).contact, { id: "contact-a", firstName: "Ada", lastName: "Example", email: "ada@example.test", phone: "+60123456789", tags: ["vip"] });
  } finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
});

test("AI auto-reply defaults off for a new tenant and is admin-service controlled", async () => {
  const { db, key } = await fixture();
  try {
    const get = () => app().request("/internal/console/tenants/tenant-a/ai-auto-reply", { headers: { Authorization: `Bearer ${key}` } }, env(db));
    assert.equal((await (await get()).json() as { enabled: boolean }).enabled, false);
    const update = await app().request("/internal/console/tenants/tenant-a/ai-auto-reply", { method: "PATCH", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) }, env(db));
    assert.equal(update.status, 200);
    assert.equal((await (await get()).json() as { enabled: boolean }).enabled, true);
  } finally { db.sqlite.close(); }
});

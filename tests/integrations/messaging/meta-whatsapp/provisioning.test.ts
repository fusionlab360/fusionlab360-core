import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import type { RequestContext } from "../../../../src/context";
import { MetaWhatsAppOnboardingService, type MetaWhatsAppOnboardingProvider } from "../../../../src/integrations/messaging/meta-whatsapp/onboarding";
import { createMetaWhatsAppRoutes } from "../../../../src/integrations/messaging/meta-whatsapp/routes";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const name of readdirSync(join(process.cwd(), "migrations")).filter((entry) => entry.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8"));
    }
    this.sqlite.exec("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B');");
  }

  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}

function appFor(db: SQLiteD1, permissions: string[] | null = ["integrations:write"], tenantId = "tenant-a") {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    if (permissions === null) return next();
    const context = {
      client: { id: "client-a", tenantId, permissions },
      tenant: { id: tenantId, name: tenantId, status: "active" },
    } as unknown as RequestContext;
    c.set("context", context);
    c.set("principal", { type: "client", clientId: "client-a", tenantId, permissions } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations/meta-whatsapp", createMetaWhatsAppRoutes());
  return app;
}

async function provision(db: SQLiteD1, permissions: string[] | null = ["integrations:write"], tenantId = "tenant-a", body?: unknown) {
  return appFor(db, permissions, tenantId).request("/integrations/meta-whatsapp/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db.binding() } as AppBindings);
}

test("authorized provisioning is tenant-scoped, idempotent, and leaves Meta disconnected", async () => {
  const db = new SQLiteD1();
  try {
    const first = await provision(db);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { created: boolean; integration: { id: string; provider: string; connectionStatus: string } };
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.integration.provider, "meta_whatsapp");
    assert.equal(firstBody.integration.connectionStatus, "not_connected");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_connections WHERE tenant_id = 'tenant-a'").get()?.count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_credentials WHERE tenant_id = 'tenant-a'").get()?.count, 0);

    const second = await provision(db, ["integrations:write"], "tenant-a", { tenantId: "tenant-b" });
    assert.equal(second.status, 200);
    const secondBody = await second.json() as { created: boolean; integration: { id: string } };
    assert.equal(secondBody.created, false);
    assert.equal(secondBody.integration.id, firstBody.integration.id);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integrations WHERE tenant_id = 'tenant-a' AND provider = 'meta_whatsapp'").get()?.count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM integrations WHERE tenant_id = 'tenant-b' AND provider = 'meta_whatsapp'").get()?.count, 0);
  } finally { db.close(); }
});

test("provisioning requires integrations:write and does not overwrite an existing record", async () => {
  const db = new SQLiteD1();
  try {
    db.sqlite.prepare("INSERT INTO integrations (id, tenant_id, provider, enabled, settings) VALUES (?, ?, 'meta_whatsapp', 0, ?)").run("existing", "tenant-a", JSON.stringify({ sentinel: true }));
    const forbidden = await provision(db, ["integrations:read"]);
    assert.equal(forbidden.status, 403);
    const accepted = await provision(db);
    assert.equal(accepted.status, 200);
    const body = await accepted.json() as { created: boolean; integration: { id: string; enabled: boolean } };
    assert.equal(body.created, false);
    assert.equal(body.integration.id, "existing");
    const row = db.sqlite.prepare("SELECT enabled, settings FROM integrations WHERE id = 'existing'").get() as { enabled: number; settings: string };
    assert.equal(row.enabled, 0);
    assert.deepEqual(JSON.parse(row.settings), { sentinel: true });
  } finally { db.close(); }
});

test("unauthenticated provisioning is denied", async () => {
  const db = new SQLiteD1();
  try { assert.equal((await provision(db, null)).status, 401); } finally { db.close(); }
});

test("a provisioned integration satisfies the existing onboarding-session contract", async () => {
  const db = new SQLiteD1();
  try {
    const response = await provision(db);
    const body = await response.json() as { integration: { id: string } };
    const provider: MetaWhatsAppOnboardingProvider = {
      exchangeAuthorizationCode: async () => ({ accessToken: "unused", scopes: [] }),
      verifyWabaAccess: async () => false,
      listPhoneNumbers: async () => [],
      verifyWebhookSubscription: async () => false,
    };
    const start = await new MetaWhatsAppOnboardingService(db.binding(), {}, provider).start({ tenantId: "tenant-a", operatorId: "client-a", integrationId: body.integration.id });
    assert.ok(start.state);
    assert.ok(start.expiresAt > Date.now());
  } finally { db.close(); }
});

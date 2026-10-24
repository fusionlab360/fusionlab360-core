import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import type { RequestContext } from "../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";
import sharedInboxRoutes from "../../../src/domain/messaging/shared-inbox-routes";
import { createApplication } from "../../../src/bootstrap/routes";

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
  close(): void { this.sqlite.close(); }
}

function seed(db: LocalD1): void {
  db.sqlite.exec(`
    INSERT INTO tenants (id, name, status) VALUES ('tenant-a', 'A', 'active'), ('tenant-b', 'B', 'active');
    INSERT INTO integrations (id, tenant_id, provider, enabled) VALUES ('integration-a', 'tenant-a', 'meta_whatsapp', 1), ('integration-b', 'tenant-b', 'meta_whatsapp', 1);
    INSERT INTO meta_whatsapp_connections (id, tenant_id, integration_id, waba_id, phone_number_id, status)
      VALUES ('connection-a', 'tenant-a', 'integration-a', 'waba-a', 'phone-a', 'active'), ('connection-b', 'tenant-b', 'integration-b', 'waba-b', 'phone-b', 'active');
    INSERT INTO messaging_connections (id, tenant_id, provider, integration_id, external_id, status)
      VALUES ('connection-a', 'tenant-a', 'meta_whatsapp', 'integration-a', 'phone-a', 'active'), ('connection-b', 'tenant-b', 'meta_whatsapp', 'integration-b', 'phone-b', 'active');
    INSERT INTO messaging_conversations (id, tenant_id, provider, connection_id, external_participant_id, created_at, updated_at)
      VALUES ('conversation-a-old', 'tenant-a', 'meta_whatsapp', 'connection-a', 'participant-old', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ('conversation-a-new', 'tenant-a', 'meta_whatsapp', 'connection-a', 'participant-new', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
             ('conversation-b', 'tenant-b', 'meta_whatsapp', 'connection-b', 'participant-b', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
    INSERT INTO messaging_messages (id, tenant_id, conversation_id, provider, external_message_id, direction, occurred_at, content_type, text_content)
      VALUES ('message-a-1', 'tenant-a', 'conversation-a-new', 'meta_whatsapp', 'provider-message-a-1', 'inbound', '2026-01-02T00:01:00Z', 'text', 'hello');
    INSERT INTO messaging_outbound_deliveries (id, tenant_id, event_id, provider, effect_key, conversation_id, payload_hash, status, connection_id, recipient_id, provider_message_id, provider_delivery_status)
      VALUES ('delivery-a-1', 'tenant-a', 'event-a-1', 'meta_whatsapp', 'effect-a-1', 'conversation-a-new', 'hash', 'sent', 'connection-a', 'participant-new', 'provider-message-a-1', 'delivered');
  `);
}

function authorizedApp(db: LocalD1, tenantId = "tenant-a", permissions: string[] = ["messaging:read"]): Hono<{ Bindings: AppBindings; Variables: AppVariables }> {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("context", { tenant: { id: tenantId }, client: { id: "client", tenantId, permissions } } as unknown as RequestContext);
    c.set("principal", { type: "client", clientId: "client", tenantId, permissions } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/messaging", sharedInboxRoutes);
  return app;
}

function env(db: LocalD1): AppBindings { return { DB: db.binding() } as AppBindings; }

test("lists only the authenticated tenant's conversations with stable cursor pagination", async () => {
  const db = new LocalD1(); seed(db);
  try {
    const app = authorizedApp(db);
    const first = await app.request("/messaging/conversations?limit=1", {}, env(db));
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json() as { conversations: Array<{ id: string }>; nextCursor: string | null };
    assert.deepEqual(firstBody.conversations.map((item) => item.id), ["conversation-a-new"]);
    assert.ok(firstBody.nextCursor);
    const second = await app.request(`/messaging/conversations?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`, {}, env(db));
    const secondBody = await second.json() as { conversations: Array<{ id: string }>; nextCursor: string | null };
    assert.deepEqual(secondBody.conversations.map((item) => item.id), ["conversation-a-old"]);
    assert.equal(secondBody.nextCursor, null);
  } finally { db.close(); }
});

test("returns tenant-owned messages and persisted delivery status", async () => {
  const db = new LocalD1(); seed(db);
  try {
    const response = await authorizedApp(db).request("/messaging/conversations/conversation-a-new/messages", {}, env(db));
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { conversation: { provider: string; channel: string }; messages: Array<{ text: string; deliveryStatus: string | null }> };
    assert.equal(body.conversation.provider, "meta_whatsapp");
    assert.equal(body.conversation.channel, "meta_whatsapp");
    assert.deepEqual(body.messages.map((message) => ({ text: message.text, deliveryStatus: message.deliveryStatus })), [{ text: "hello", deliveryStatus: "delivered" }]);
    assert.doesNotMatch(JSON.stringify(body), /ciphertext|accessToken|payload|secret/i);
  } finally { db.close(); }
});

test("cross-tenant conversation access returns not found", async () => {
  const db = new LocalD1(); seed(db);
  try {
    const response = await authorizedApp(db, "tenant-a").request("/messaging/conversations/conversation-b/messages", {}, env(db));
    assert.equal(response.status, 404);
  } finally { db.close(); }
});

test("missing messaging permission is denied", async () => {
  const db = new LocalD1(); seed(db);
  try {
    const response = await authorizedApp(db, "tenant-a", []).request("/messaging/conversations", {}, env(db));
    assert.equal(response.status, 403);
  } finally { db.close(); }
});

test("missing and invalid authentication are rejected by the production route composition", async () => {
  const app = createApplication("production");
  const env = { DB: {} as D1Database, JWT_SECRET: "test", JWT_ISSUER: "test", JWT_AUDIENCE: "test" } as AppBindings;
  assert.equal((await app.request("/messaging/conversations", {}, env)).status, 401);
  assert.equal((await app.request("/messaging/conversations", { headers: { Authorization: "Bearer invalid" } }, env)).status, 401);
  assert.equal((await app.request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" }, body: JSON.stringify({ text: "x", idempotencyKey: "invalid-auth" }) }, env)).status, 401);
});

test("empty inbox returns an empty page", async () => {
  const db = new LocalD1();
  try {
    db.sqlite.exec("INSERT INTO tenants (id, name, status) VALUES ('empty-tenant', 'Empty', 'active')");
    const response = await authorizedApp(db, "empty-tenant").request("/messaging/conversations", {}, env(db));
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { success: true, conversations: [], nextCursor: null });
  } finally { db.close(); }
});

test("rejects malformed cursors and unbounded page sizes", async () => {
  const db = new LocalD1(); seed(db);
  try {
    const app = authorizedApp(db);
    assert.equal((await app.request("/messaging/conversations?cursor=bad", {}, env(db))).status, 400);
    assert.equal((await app.request("/messaging/conversations?limit=101", {}, env(db))).status, 400);
  } finally { db.close(); }
});

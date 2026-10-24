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
import { createSharedInboxRoutes } from "../../../src/domain/messaging/shared-inbox-routes";
import { MetaWhatsAppOutboundService } from "../../../src/integrations/messaging/meta-whatsapp/outbound";
import { createMetaWhatsAppCredentialVault } from "../../../src/integrations/messaging/meta-whatsapp/credential-vault";

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

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const bindings = {
  META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: key }),
  META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1",
};

async function fixture(provider = "meta_whatsapp") {
  const db = new LocalD1();
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES ('tenant-a','A','active'),('tenant-b','B','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('integration-a','tenant-a','meta_whatsapp',1),('integration-b','tenant-b','meta_whatsapp',1);
    INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status)
      VALUES ('connection-a','tenant-a','integration-a','waba-a','phone-a','active'),('connection-b','tenant-b','integration-b','waba-b','phone-b','active');
    INSERT INTO messaging_connections(id,tenant_id,provider,integration_id,external_id,status)
      VALUES ('connection-a','tenant-a','meta_whatsapp','integration-a','phone-a','active'),('connection-b','tenant-b','meta_whatsapp','integration-b','phone-b','active');
  `);
  db.sqlite.prepare("INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id) VALUES (?,?,?,?,?)").run("conversation-a", "tenant-a", provider, "connection-a", "participant-a");
  db.sqlite.prepare("INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id) VALUES (?,?,?,?,?)").run("conversation-b", "tenant-b", "meta_whatsapp", "connection-b", "participant-b");
  db.sqlite.prepare("INSERT INTO messaging_messages(id,tenant_id,conversation_id,provider,external_message_id,direction,occurred_at,content_type,text_content) VALUES (?,?,?,?,?,?,?,?,?)").run("inbound-a", "tenant-a", "conversation-a", "meta_whatsapp", "inbound-a", "inbound", new Date().toISOString(), "text", "hello");
  const vault = createMetaWhatsAppCredentialVault(db.binding(), bindings);
  await vault.create({ tenantId: "tenant-a", integrationId: "integration-a", connectionId: "connection-a", provider: "meta_whatsapp", accessToken: "synthetic-token" });
  return db;
}

function app(db: LocalD1, service: MetaWhatsAppOutboundService, permissions: string[] = ["messaging:write"]) {
  const routes = createSharedInboxRoutes(() => service);
  const application = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  application.use("*", async (c, next) => {
    c.set("principal", { type: "client", clientId: "client-a", tenantId: "tenant-a", permissions } satisfies AuthenticatedPrincipal);
    c.set("context", { tenant: { id: "tenant-a" }, client: { id: "client-a", tenantId: "tenant-a", permissions } } as unknown as RequestContext);
    await next();
  });
  application.route("/messaging", routes);
  return application;
}

function env(db: LocalD1): AppBindings { return { DB: db.binding() } as AppBindings; }

test("authorized Meta reply is persisted in inbox and duplicate idempotency does not resend", async () => {
  const db = await fixture();
  try {
    let sends = 0;
    const service = new MetaWhatsAppOutboundService(db.binding(), bindings, {
      sendText: async () => { sends += 1; return { state: "accepted", providerMessageId: "wamid-out-1" }; },
    });
    const application = app(db, service);
    const request = () => application.request("/messaging/conversations/conversation-a/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Reply from operator", idempotencyKey: "reply-1" }),
    }, env(db));
    const first = await request();
    assert.equal(first.status, 202, await first.clone().text());
    const firstBody = await first.json() as { message: { direction: string; providerMessageId: string | null; deliveryStatus: string | null } };
    assert.deepEqual({ direction: firstBody.message.direction, providerMessageId: firstBody.message.providerMessageId, deliveryStatus: firstBody.message.deliveryStatus }, { direction: "outbound", providerMessageId: "wamid-out-1", deliveryStatus: "accepted" });
    assert.doesNotMatch(JSON.stringify(firstBody), /synthetic-token|accessToken|Authorization/i);
    const second = await request();
    assert.equal(second.status, 202);
    assert.equal(sends, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_messages WHERE direction='outbound'").get()?.count, 1);
  } finally { db.close(); }
});

test("reply authorization and ownership fail closed, and a different body cannot reuse an idempotency key", async () => {
  const db = await fixture();
  try {
    const service = new MetaWhatsAppOutboundService(db.binding(), bindings, { sendText: async () => ({ state: "accepted", providerMessageId: "wamid-out-2" }) });
    const invalid = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "", idempotencyKey: "reply-invalid" }) }, env(db));
    assert.equal(invalid.status, 400);
    const denied = await app(db, service, ["messaging:read"]).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", idempotencyKey: "reply-2" }) }, env(db));
    assert.equal(denied.status, 403);
    const crossTenant = await app(db, service).request("/messaging/conversations/conversation-b/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", idempotencyKey: "reply-3" }) }, env(db));
    assert.equal(crossTenant.status, 404);
    const first = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "first", idempotencyKey: "reply-4" }) }, env(db));
    assert.equal(first.status, 202);
    const conflict = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "different", idempotencyKey: "reply-4" }) }, env(db));
    assert.equal(conflict.status, 409);
  } finally { db.close(); }
});

test("unsupported conversation provider is rejected without routing to Meta", async () => {
  const db = await fixture("gohighlevel");
  try {
    const service = new MetaWhatsAppOutboundService(db.binding(), bindings, { sendText: async () => ({ state: "accepted", providerMessageId: "should-not-send" }) });
    const response = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", idempotencyKey: "reply-5" }) }, env(db));
    assert.equal(response.status, 422);
  } finally { db.close(); }
});

test("disabled connections and expired service windows are rejected before provider delivery", async () => {
  const db = await fixture();
  try {
    const service = new MetaWhatsAppOutboundService(db.binding(), bindings, { sendText: async () => ({ state: "accepted", providerMessageId: "should-not-send" }) });
    db.sqlite.prepare("UPDATE meta_whatsapp_connections SET status='disabled' WHERE id='connection-a'").run();
    const disabled = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", idempotencyKey: "reply-6" }) }, env(db));
    assert.equal(disabled.status, 409);
    db.sqlite.prepare("UPDATE meta_whatsapp_connections SET status='active'").run();
    db.sqlite.prepare("UPDATE messaging_messages SET occurred_at=? WHERE id='inbound-a'").run("2020-01-01T00:00:00.000Z");
    const expired = await app(db, service).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", idempotencyKey: "reply-7" }) }, env(db));
    assert.equal(expired.status, 409);
  } finally { db.close(); }
});

test("unknown provider outcomes remain visible and status reconciliation updates the inbox projection", async () => {
  const db = await fixture();
  try {
    const unknownService = new MetaWhatsAppOutboundService(db.binding(), bindings, { sendText: async () => { throw new Error("private provider detail"); } });
    const unknown = await app(db, unknownService).request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "uncertain", idempotencyKey: "reply-8" }) }, env(db));
    assert.equal(unknown.status, 202);
    const unknownBody = await unknown.json() as { deliveryState: string; message: { deliveryStatus: string } };
    assert.equal(unknownBody.deliveryState, "unknown");
    assert.equal(unknownBody.message.deliveryStatus, "unknown");

    const service = new MetaWhatsAppOutboundService(db.binding(), bindings, { sendText: async () => ({ state: "accepted", providerMessageId: "wamid-out-9" }) });
    const authorized = app(db, service, ["messaging:read", "messaging:write"]);
    const accepted = await authorized.request("/messaging/conversations/conversation-a/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "delivered", idempotencyKey: "reply-9" }) }, env(db));
    assert.equal(accepted.status, 202);
    await service.reconcileStatus({ tenantId: "tenant-a", connectionId: "connection-a", providerMessageId: "wamid-out-9", status: "delivered" });
    const history = await authorized.request("/messaging/conversations/conversation-a/messages", {}, env(db));
    const historyBody = await history.json() as { messages: Array<{ providerMessageId: string | null; deliveryStatus: string | null }> };
    assert.equal(historyBody.messages.find((message) => message.providerMessageId === "wamid-out-9")?.deliveryStatus, "delivered");
  } finally { db.close(); }
});

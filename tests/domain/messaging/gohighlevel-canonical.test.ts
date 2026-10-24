import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Hono } from "hono";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import type { RequestContext } from "../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../src/core/security/principal";
import { createSharedInboxRoutes } from "../../../src/domain/messaging/shared-inbox-routes";
import { MessagingConversationRepository } from "../../../src/persistence/repositories/messaging-conversation-repository";

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
    INSERT INTO tenants(id,name,status) VALUES ('tenant-a','A','active'),('tenant-b','B','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('ghl-a','tenant-a','gohighlevel',1),('ghl-b','tenant-b','gohighlevel',1);
    INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id)
      VALUES ('tenant-a','gohighlevel','api_key','synthetic-token-a','location-a'),
             ('tenant-b','gohighlevel','api_key','synthetic-token-b','location-b');
  `);
}

test("GHL inbound messages persist canonically, preserve channel identity, and deduplicate webhook retries", async () => {
  const db = new LocalD1();
  try {
    seed(db);
    const repository = new MessagingConversationRepository(db.binding());
    const input = {
      tenantId: "tenant-a",
      locationId: "location-a",
      contactId: "contact-a",
      conversationId: "conversation-a",
      messageId: "ghl-message-1",
      occurredAt: "2026-01-02T00:00:00.000Z",
      text: "hello",
      channel: "whatsapp",
      channelProviderId: "custom-provider-a",
    };
    await repository.upsertGHLInbound(input);
    await repository.upsertGHLInbound(input);
    await repository.upsertGHLInbound({ ...input, messageId: "ghl-message-2", occurredAt: "2026-01-01T00:00:00.000Z", text: "earlier" });

    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_conversations").get()?.count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_messages").get()?.count, 2);
    const conversationId = String(db.sqlite.prepare("SELECT id FROM messaging_conversations WHERE tenant_id = 'tenant-a' AND external_conversation_id = 'conversation-a'").get()?.id);
    const conversation = await repository.findForTenant("tenant-a", conversationId);
    assert.deepEqual({ provider: conversation?.provider, channel: conversation?.channel, participant: conversation?.externalParticipantId, externalId: conversation?.externalConversationId }, {
      provider: "gohighlevel", channel: "whatsapp", participant: "contact-a", externalId: "conversation-a",
    });
    const page = await repository.listMessagesForTenant("tenant-a", conversation!.id, { limit: 20 });
    assert.deepEqual(page.items.map((message) => ({ id: message.externalMessageId, text: message.text, channel: message.channel })), [
      { id: "ghl-message-2", text: "earlier", channel: "whatsapp" },
      { id: "ghl-message-1", text: "hello", channel: "whatsapp" },
    ]);
  } finally { db.close(); }
});
test("GHL canonical persistence fails closed for another tenant or inactive integration", async () => {
  const db = new LocalD1();
  try {
    seed(db);
    const repository = new MessagingConversationRepository(db.binding());
    await assert.rejects(repository.upsertGHLInbound({
      tenantId: "tenant-a", locationId: "location-b", contactId: "contact-b",
      conversationId: "conversation-b", messageId: "ghl-cross-tenant", occurredAt: new Date().toISOString(),
      text: "must not cross tenants", channel: "live_chat",
    }), /not active/);
    db.sqlite.prepare("UPDATE integrations SET enabled = 0 WHERE id = 'ghl-a'").run();
    await assert.rejects(repository.upsertGHLInbound({
      tenantId: "tenant-a", locationId: "location-a", contactId: "contact-a",
      conversationId: "conversation-disabled", messageId: "ghl-disabled", occurredAt: new Date().toISOString(),
      text: "must be rejected", channel: "live_chat",
    }), /not active/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_messages").get()?.count, 0);
  } finally { db.close(); }
});

test("GHL conversation identity cannot be rebound to a different contact", async () => {
  const db = new LocalD1();
  try {
    seed(db);
    const repository = new MessagingConversationRepository(db.binding());
    await repository.upsertGHLInbound({
      tenantId: "tenant-a", locationId: "location-a", contactId: "contact-a",
      conversationId: "conversation-a", messageId: "ghl-owner", occurredAt: new Date().toISOString(),
      text: "first", channel: "live_chat",
    });
    await assert.rejects(repository.upsertGHLInbound({
      tenantId: "tenant-a", locationId: "location-a", contactId: "contact-other",
      conversationId: "conversation-a", messageId: "ghl-rebound", occurredAt: new Date().toISOString(),
      text: "must be rejected", channel: "live_chat",
    }), /participant ownership/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_messages").get()?.count, 1);
  } finally { db.close(); }
});

test("canonical GHL messages are visible through the tenant-scoped shared inbox read API", async () => {
  const db = new LocalD1();
  try {
    seed(db);
    const repository = new MessagingConversationRepository(db.binding());
    await repository.upsertGHLInbound({
      tenantId: "tenant-a", locationId: "location-a", contactId: "contact-a",
      conversationId: "conversation-a", messageId: "ghl-visible", occurredAt: "2026-01-01T00:00:00.000Z",
      text: "visible in inbox", channel: "live_chat",
    });
    const conversationId = String(db.sqlite.prepare("SELECT id FROM messaging_conversations WHERE external_conversation_id = 'conversation-a'").get()?.id);
    const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("context", { tenant: { id: "tenant-a" }, client: { id: "client-a", tenantId: "tenant-a", permissions: ["messaging:read"] } } as unknown as RequestContext);
      c.set("principal", { type: "client", clientId: "client-a", tenantId: "tenant-a", permissions: ["messaging:read"] } satisfies AuthenticatedPrincipal);
      await next();
    });
    app.route("/messaging", createSharedInboxRoutes());
    const response = await app.request(`/messaging/conversations/${conversationId}/messages`, {}, { DB: db.binding() } as AppBindings);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { conversation: { provider: string; channel: string }; messages: Array<{ text: string; provider: string }> };
    assert.equal(body.conversation.provider, "gohighlevel");
    assert.equal(body.conversation.channel, "live_chat");
    assert.deepEqual(body.messages.map((message) => ({ text: message.text, provider: message.provider })), [{ text: "visible in inbox", provider: "gohighlevel" }]);
  } finally { db.close(); }
});

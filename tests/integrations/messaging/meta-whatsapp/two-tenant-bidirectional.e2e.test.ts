import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { IntegrationEventRepository } from "../../../../src/persistence/repositories/integration-event-repository";
import { IntegrationEventService } from "../../../../src/core/events/service";
import { createMetaWhatsAppInboundHandler, processMetaWhatsAppInboundEvent } from "../../../../src/integrations/messaging/meta-whatsapp/inbound-handler";
import { metaWhatsAppWebhookController } from "../../../../src/integrations/messaging/meta-whatsapp/webhook-controller";
import { consumeGHLInboundQueue } from "../../../../src/domain/messaging/inbound-queue";
import { createGHLProviderOutboundController } from "../../../../src/integrations/messaging/gohighlevel/provider-outbound";
import { resolveTenantByProviderLocation } from "../../../../src/tenants/service";
import { MetaWhatsAppConnectionRepository } from "../../../../src/integrations/messaging/meta-whatsapp/persistence/connection-repository";
import { MetaWhatsAppOutboundService, type MetaSendOutcome } from "../../../../src/integrations/messaging/meta-whatsapp/outbound";
import { createMetaWhatsAppCredentialVault } from "../../../../src/integrations/messaging/meta-whatsapp/credential-vault";
import { reconcileMetaWhatsAppStatus } from "../../../../src/integrations/messaging/meta-whatsapp/outbound";
import { deliverGHLProviderOutboundToMeta } from "../../../../src/integrations/messaging/gohighlevel/provider-outbound-meta";
import { isMetaConnectionEligible } from "../../../../src/integrations/messaging/meta-whatsapp/connection-eligibility";

const metaSecret = "synthetic-meta-app-secret";
const encKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const tenants = [
  { id: "synthetic-a", loc: "location-a", provider: "provider-a", phone: "phone-a", connection: "connection-a", conversation: "conversation-a", participant: "60111111111", contact: "contact-a", waba: "waba-a" },
  { id: "synthetic-b", loc: "location-b", provider: "provider-b", phone: "phone-b", connection: "connection-b", conversation: "conversation-b", participant: "60222222222", contact: "contact-b", waba: "waba-b" },
] as const;

class LocalD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor(pre0042 = false) {
    for (const filename of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      if (pre0042 && filename.startsWith("0042_")) break;
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
    }
  }
  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const stmt = {
      bind: (...next: unknown[]) => { values = next; return stmt; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return stmt as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run())); }
  binding() { return this as unknown as D1Database; }
  close() { this.sqlite.close(); }
}

async function hmac(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(metaSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function fixture() {
  const db = new LocalD1();
  db.sqlite.exec("INSERT INTO tenants(id,name,status) VALUES('synthetic-a','A','active'),('synthetic-b','B','active')");
  for (const t of tenants) {
    db.sqlite.prepare("INSERT INTO integrations(id,tenant_id,provider,settings) VALUES(?,?, 'gohighlevel', ?)").run(`ghl-${t.id}`, t.id, JSON.stringify({ providerConfiguration: { conversationProviderId: t.provider } }));
    db.sqlite.prepare("INSERT INTO integrations(id,tenant_id,provider) VALUES(?,?,'meta_whatsapp')").run(`meta-${t.id}`, t.id);
    db.sqlite.prepare("INSERT INTO integration_credentials(tenant_id,provider,auth_type,location_id,api_key) VALUES(?,'gohighlevel','oauth2',?,?)").run(t.id, t.loc, `synthetic-oauth-${t.id}`);
    db.sqlite.prepare("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES(?,?,?,?,?,'active')").run(t.connection, t.id, `meta-${t.id}`, t.waba, t.phone);
    db.sqlite.prepare("UPDATE meta_whatsapp_connections SET activation_state='active',ghl_location_id=?,ghl_provider_id=?,activation_actor='local-approval',activation_reason='synthetic-e2e-setup' WHERE id=?").run(t.loc, t.provider, t.connection);
    db.sqlite.prepare("INSERT INTO messaging_connections(id,tenant_id,provider,integration_id,external_id,status) VALUES(?,?,'meta_whatsapp',?,?, 'active')").run(t.connection, t.id, `meta-${t.id}`, t.phone);
    db.sqlite.prepare("INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id) VALUES(?,?,'meta_whatsapp',?,?)").run(t.conversation, t.id, t.connection, t.participant);
    const vault = createMetaWhatsAppCredentialVault(db.binding(), { META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: encKey }), META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1" } as AppBindings);
    await vault.create({ tenantId: t.id, integrationId: `meta-${t.id}`, connectionId: t.connection, provider: "meta_whatsapp", accessToken: `synthetic-token-${t.id}`, metadata: { expiresAt: Date.now() + 3600_000, lifecycle: "expiring" } });
  }
  const queue: Array<{ body: Record<string, unknown>; acked: boolean; retried: boolean }> = [];
  const publish: Array<{ tenantId: string; connectionId: string; contactId: string; messageId: string }> = [];
  let deliverFailureType = "";
  const env = {
    DB: db.binding(), META_WHATSAPP_APP_SECRET: metaSecret,
    META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: encKey }), META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1",
    META_WHATSAPP_GRAPH_API_VERSION: "v26.0", GHL_OAUTH_CLIENT_ID: "synthetic-client", GHL_OAUTH_CLIENT_SECRET: "synthetic-secret", GHL_OAUTH_REDIRECT_URI: "https://unit.test/callback",
    NEW_QUEUE_ENVELOPES_ENABLED: "true", META_WHATSAPP_GHL_INBOUND_ENABLED: "true", META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST: tenants.map((t) => t.id).join(","),
    GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: tenants.map((t) => t.loc).join(","), GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true",
    WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "true",
    GHL_INBOUND_QUEUE: { send: async (body: Record<string, unknown>) => { queue.push({ body, acked: false, retried: false }); } },
  } as unknown as AppBindings;
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.all("/webhooks/meta-whatsapp", metaWhatsAppWebhookController);
  const outboundController = createGHLProviderOutboundController({
    verifySignature: async (raw, signature) => signature === await hmac(raw),
    resolveTenant: resolveTenantByProviderLocation,
    deliver: async (bindings, tenant, payload): Promise<MetaSendOutcome> => {
      const t = tenants.find((candidate) => candidate.id === tenant.id);
      if (!t) return { state: "permanent", code: "tenant_mismatch" };
      const transport = { sendText: async () => { sendsByTenant.set(t.id, (sendsByTenant.get(t.id) ?? 0) + 1); return { state: "accepted" as const, providerMessageId: `out-${payload.messageId}` }; } };
      try {
        return await deliverGHLProviderOutboundToMeta(bindings, tenant, payload, {
          lookupContact: async (_context, phone) => `+${String(phone).replace(/\D/g, "")}` === `+${t.participant}` ? t.contact : null,
          send: (input) => new MetaWhatsAppOutboundService(bindings.DB, bindings, transport).send(input),
        });
      } catch (error) { deliverFailureType = error instanceof Error ? error.name : "unknown"; throw error; }
    },
  });
  app.post("/webhooks/gohighlevel/provider-outbound", outboundController);
  const sendsByTenant = new Map<string, number>();
  return { db, env, app, queue, publish, sendsByTenant, get deliverFailureType() { return deliverFailureType; } };
}

function metaMessage(t: typeof tenants[number], id: string) {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: t.phone }, messages: [{ id, from: t.participant.replace("+", ""), timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: `synthetic-${id}` } }] } }] }] });
}

function metaStatus(phoneNumberId: string, id: string, status: string) {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
}

test("two-tenant bidirectional path isolates messages, deduplicates events, and correlates receipts", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external HTTP request in local E2E."); };
  try {
    for (const t of tenants) {
      const body = metaMessage(t, `in-${t.id}`);
      const headers = { "X-Hub-Signature-256": await hmac(body) };
      assert.equal((await f.app.request("/webhooks/meta-whatsapp", { method: "POST", headers, body }, f.env)).status, 200);
      assert.equal((await f.app.request("/webhooks/meta-whatsapp", { method: "POST", headers, body }, f.env)).status, 200);
    }
    assert.equal(f.queue.length, 2);
    const providerHandlers = new Map([["meta_whatsapp", (event: Parameters<ReturnType<typeof createMetaWhatsAppInboundHandler>>[0], bindings: AppBindings) => processMetaWhatsAppInboundEvent(event, bindings.DB, new IntegrationEventService(new IntegrationEventRepository(bindings.DB)), bindings, async ({ event: inboundEvent, value, connection }) => {
      f.publish.push({ tenantId: inboundEvent.tenantId, connectionId: connection!.id, contactId: String(value.contactId), messageId: String(value.providerMessageId) });
    })]]);
    const batch = { messages: f.queue.map((item) => ({ body: item.body, attempts: 1, timestamp: new Date(), ack: () => { item.acked = true; }, retry: () => { item.retried = true; } })) } as unknown as MessageBatch<import("../../../../src/domain/messaging/inbound-queue-contract").GHLInboundQueueEnvelope>;
    await consumeGHLInboundQueue(batch, f.env, undefined, undefined, providerHandlers);
    await consumeGHLInboundQueue(batch, f.env, undefined, undefined, providerHandlers);
    assert.equal(f.publish.length, 2);
    assert.deepEqual(f.publish.map((item) => [item.tenantId, item.connectionId]).sort(), [["synthetic-a", "connection-a"], ["synthetic-b", "connection-b"]].sort());
    assert.ok(f.queue.every((item) => item.acked && !item.retried));

    for (const t of tenants) {
      const payload = { contactId: t.contact, locationId: t.loc, messageId: `staff-${t.id}`, type: "SMS", message: `reply-${t.id}`, phone: t.participant, userId: `agent-${t.id}` };
      const raw = JSON.stringify(payload);
      const headers = { "Content-Type": "application/json", "X-GHL-Signature": await hmac(raw) };
      const firstOutbound = await f.app.request("/webhooks/gohighlevel/provider-outbound", { method: "POST", headers, body: raw }, f.env);
      assert.equal(firstOutbound.status, 200, `${await firstOutbound.clone().text()} ${f.deliverFailureType}`);
      assert.equal((await f.app.request("/webhooks/gohighlevel/provider-outbound", { method: "POST", headers, body: raw }, f.env)).status, 200);
    }
    assert.deepEqual(Object.fromEntries(f.sendsByTenant), { "synthetic-a": 1, "synthetic-b": 1 });
    f.db.sqlite.prepare("UPDATE messaging_messages SET occurred_at=? WHERE tenant_id='synthetic-a' AND direction='inbound'").run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    const expiredPayload = { contactId: tenants[0].contact, locationId: tenants[0].loc, messageId: "outside-service-window", type: "SMS", message: "must not send", phone: tenants[0].participant, userId: "agent-a" };
    const expiredRaw = JSON.stringify(expiredPayload);
    const expiredResult = await f.app.request("/webhooks/gohighlevel/provider-outbound", { method: "POST", headers: { "Content-Type": "application/json", "X-GHL-Signature": await hmac(expiredRaw) }, body: expiredRaw }, f.env);
    assert.equal(expiredResult.status, 422);
    assert.equal(f.sendsByTenant.get("synthetic-a"), 1);
    for (const t of tenants) {
      const row = f.db.sqlite.prepare("SELECT tenant_id,connection_id,conversation_id,provider_message_id FROM messaging_outbound_deliveries WHERE event_id=?").get(`ghl-provider:staff-${t.id}`) as Record<string, string>;
      assert.ok(row, JSON.stringify(f.db.sqlite.prepare("SELECT tenant_id,event_id,effect_key,connection_id,conversation_id,status FROM messaging_outbound_deliveries").all()));
      assert.equal(row.tenant_id, t.id); assert.equal(row.connection_id, t.connection); assert.equal(row.conversation_id, t.conversation); assert.equal(row.provider_message_id, `out-staff-${t.id}`);
    }
    for (const [phoneOwner, receiptOwner, status] of [[tenants[0], tenants[0], "sent"], [tenants[1], tenants[0], "delivered"], [tenants[1], tenants[1], "delivered"]] as const) {
      const statusBody = metaStatus(phoneOwner.phone, `out-staff-${receiptOwner.id}`, status);
      assert.equal((await f.app.request("/webhooks/meta-whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": await hmac(statusBody) }, body: statusBody }, f.env)).status, 200);
    }
    const statusBatch = { messages: f.queue.slice(2).map((item) => ({ body: item.body, attempts: 1, timestamp: new Date(), ack: () => { item.acked = true; }, retry: () => { item.retried = true; } })) } as unknown as MessageBatch<import("../../../../src/domain/messaging/inbound-queue-contract").GHLInboundQueueEnvelope>;
    const statusProviderHandlers = new Map([["meta_whatsapp", createMetaWhatsAppInboundHandler()]]);
    await consumeGHLInboundQueue(statusBatch, f.env, undefined, undefined, statusProviderHandlers);
    assert.equal(f.db.sqlite.prepare("SELECT provider_delivery_status FROM messaging_outbound_deliveries WHERE event_id='ghl-provider:staff-synthetic-a'").get()?.provider_delivery_status, "sent");
    assert.equal(f.db.sqlite.prepare("SELECT provider_delivery_status FROM messaging_outbound_deliveries WHERE event_id='ghl-provider:staff-synthetic-b'").get()?.provider_delivery_status, "delivered");
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM messaging_outbound_deliveries WHERE provider_delivery_status='delivered'").get()?.n, 1);
    await assert.rejects(reconcileMetaWhatsAppStatus(f.db.binding(), { tenantId: "synthetic-b", connectionId: "connection-a", providerMessageId: "out-staff-synthetic-a", status: "read" }));
    const crossConversation = new MetaWhatsAppOutboundService(f.db.binding(), f.env, { sendText: async () => { throw new Error("cross-tenant send must not happen"); } });
    await assert.rejects(crossConversation.send({ tenantId: "synthetic-b", connectionId: "connection-b", conversationId: "conversation-a", recipientId: tenants[1].participant, text: "x", effectKey: "cross-conversation" }));
  } finally { globalThis.fetch = originalFetch; f.db.close(); }
});

test("lifecycle enforcement rejects unapproved, suspended, and revoked connections while gate-off preserves legacy inbound", async () => {
  const f = await fixture();
  try {
    const pendingTenant = tenants[0];
    f.db.sqlite.prepare("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('pending-connection',?,'meta-synthetic-a','pending-waba','pending-phone','active')").run(pendingTenant.id);
    f.db.sqlite.prepare("INSERT INTO messaging_connections(id,tenant_id,provider,integration_id,external_id,status) VALUES('pending-connection',?,'meta_whatsapp','meta-synthetic-a','pending-phone','active')").run(pendingTenant.id);
    f.db.sqlite.prepare("INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id) VALUES('pending-conversation',?,'meta_whatsapp','pending-connection','60333333333')").run(pendingTenant.id);
    f.db.sqlite.prepare("INSERT INTO messaging_messages(id,tenant_id,conversation_id,provider,external_message_id,direction,occurred_at,content_type,text_content) VALUES('pending-inbound',?,'pending-conversation','meta_whatsapp','pending-inbound','inbound',?,'text','fixture')").run(pendingTenant.id, new Date().toISOString());
    const pendingService = new MetaWhatsAppOutboundService(f.db.binding(), f.env, { sendText: async () => { throw new Error("pending connection must not dispatch"); } });
    await assert.rejects(pendingService.send({ tenantId: pendingTenant.id, connectionId: "pending-connection", conversationId: "pending-conversation", recipientId: "60333333333", text: "denied", effectKey: "pending-send" }));
    assert.equal(await isMetaConnectionEligible(f.db.binding(), f.env, pendingTenant.id, "pending-connection"), false);
    for (const [i, state] of [[0, "pending"], [1, "suspended"]] as const) {
      const t = tenants[i];
      if (state === "suspended") f.db.sqlite.prepare("UPDATE meta_whatsapp_connections SET activation_state='suspended',activation_actor='reviewer',activation_reason='test suspension' WHERE id=?").run(t.connection);
      const connectionId = state === "pending" ? "pending-connection" : t.connection;
      const phoneNumberId = state === "pending" ? "pending-phone" : t.phone;
      const events = new IntegrationEventService(new IntegrationEventRepository(f.db.binding()));
      const accepted = await events.accept({ eventId: `eligibility-${t.id}`, eventType: "messaging.meta_whatsapp.inbound", aggregateType: "message", aggregateId: `eligibility-${t.id}`, tenantId: t.id, provider: "meta_whatsapp", occurredAt: new Date().toISOString(), payload: { provider: "meta_whatsapp", phoneNumberId, providerMessageId: `eligibility-${t.id}`, contactId: t.participant, text: "synthetic", occurredAt: new Date().toISOString() } });
      const event = await new IntegrationEventRepository(f.db.binding()).find(t.id, accepted.event.eventId);
      assert.ok(event);
      let published = 0;
      await assert.rejects(processMetaWhatsAppInboundEvent(event, f.db.binding(), events, f.env, async () => { published++; }));
      assert.equal(published, 0);
    }
    f.db.sqlite.prepare("INSERT INTO meta_whatsapp_legacy_approval_reviews(connection_id,tenant_id,ghl_location_id,ghl_provider_id,reviewer_client_id,evidence_ref) VALUES('pending-connection',?,'location-a','provider-a','reviewer-fixture','approved-fixture-evidence')").run(pendingTenant.id);
    assert.equal(await isMetaConnectionEligible(f.db.binding(), f.env, pendingTenant.id, "pending-connection"), true);
    const suspended = tenants[1];
    const suspendedPayload = { contactId: suspended.contact, locationId: suspended.loc, messageId: "suspended-outbound", type: "SMS", message: "must not send", phone: suspended.participant, userId: "agent-b" };
    const suspendedRaw = JSON.stringify(suspendedPayload);
    const suspendedResult = await f.app.request("/webhooks/gohighlevel/provider-outbound", { method: "POST", headers: { "Content-Type": "application/json", "X-GHL-Signature": await hmac(suspendedRaw) }, body: suspendedRaw }, f.env);
    assert.notEqual(suspendedResult.status, 200);
    assert.equal(f.sendsByTenant.get(suspended.id) ?? 0, 0);
    const revoked = tenants[1];
    f.db.sqlite.prepare("UPDATE meta_whatsapp_connections SET activation_state='revoked',activation_actor='reviewer',activation_reason='test revocation' WHERE id=?").run(revoked.connection);
    const out = await f.app.request("/webhooks/gohighlevel/provider-outbound", { method: "POST", headers: { "Content-Type": "application/json", "X-GHL-Signature": await hmac(JSON.stringify({ contactId: revoked.contact, locationId: revoked.loc, messageId: "revoked", type: "SMS", message: "x", phone: revoked.participant })) }, body: JSON.stringify({ contactId: revoked.contact, locationId: revoked.loc, messageId: "revoked", type: "SMS", message: "x", phone: revoked.participant }) }, f.env);
    assert.notEqual(out.status, 200);
    assert.equal(f.sendsByTenant.get(revoked.id) ?? 0, 0);
    const revokedEventService = new IntegrationEventService(new IntegrationEventRepository(f.db.binding()));
    const revokedAccepted = await revokedEventService.accept({ eventId: "revoked-inbound", eventType: "messaging.meta_whatsapp.inbound", aggregateType: "message", aggregateId: "revoked-inbound", tenantId: revoked.id, provider: "meta_whatsapp", occurredAt: new Date().toISOString(), payload: { provider: "meta_whatsapp", phoneNumberId: revoked.phone, providerMessageId: "revoked-inbound", contactId: revoked.participant, text: "synthetic", occurredAt: new Date().toISOString() } });
    const revokedEvent = await new IntegrationEventRepository(f.db.binding()).find(revoked.id, revokedAccepted.event.eventId);
    assert.ok(revokedEvent);
    await assert.rejects(processMetaWhatsAppInboundEvent(revokedEvent, f.db.binding(), revokedEventService, f.env, async () => { throw new Error("revoked connection forwarded"); }));
    const legacyEnv = { ...f.env, WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "false" } as AppBindings;
    const legacyService = new IntegrationEventService(new IntegrationEventRepository(f.db.binding()));
    const legacyAccepted = await legacyService.accept({ eventId: "gate-off-legacy", eventType: "messaging.meta_whatsapp.inbound", aggregateType: "message", aggregateId: "gate-off-legacy", tenantId: revoked.id, provider: "meta_whatsapp", occurredAt: new Date().toISOString(), payload: { provider: "meta_whatsapp", phoneNumberId: revoked.phone, providerMessageId: "gate-off-legacy", contactId: revoked.participant, text: "synthetic", occurredAt: new Date().toISOString() } });
    const legacyEvent = await new IntegrationEventRepository(f.db.binding()).find(revoked.id, legacyAccepted.event.eventId);
    assert.ok(legacyEvent);
    let legacyPublished = 0;
    await processMetaWhatsAppInboundEvent(legacyEvent, f.db.binding(), legacyService, legacyEnv, async () => { legacyPublished++; });
    assert.equal(legacyPublished, 1);
  } finally { f.db.close(); }
});

test("production-shaped pre-0042 schema continues inbound webhook and Queue processing with lifecycle enforcement off", async () => {
  const db = new LocalD1(true);
  const queue: Array<{ body: Record<string, unknown>; acked: boolean }> = [];
  const phoneId = "pre42-phone";
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES('pre42-tenant','Pre42','active');
    INSERT INTO integrations(id,tenant_id,provider) VALUES('pre42-meta','pre42-tenant','meta_whatsapp');
    INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status)
      VALUES('pre42-connection','pre42-tenant','pre42-meta','pre42-waba','${phoneId}','active');
    INSERT INTO messaging_connections(id,tenant_id,provider,integration_id,external_id,status)
      VALUES('pre42-connection','pre42-tenant','meta_whatsapp','pre42-meta','${phoneId}','active');
  `);
  const published: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external HTTP request in pre-0042 inbound test."); };
  try {
    const env = {
      DB: db.binding(), META_WHATSAPP_APP_SECRET: metaSecret,
      META_WHATSAPP_GHL_INBOUND_ENABLED: "true", META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST: "pre42-tenant",
      NEW_QUEUE_ENVELOPES_ENABLED: "true", WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "false",
      GHL_INBOUND_QUEUE: { send: async (body: Record<string, unknown>) => { queue.push({ body, acked: false }); } },
    } as unknown as AppBindings;
    const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
    app.all("/webhooks/meta-whatsapp", metaWhatsAppWebhookController);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneId }, messages: [{ id: "pre42-inbound-1", from: "60123456789", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "synthetic pre42" } }] } }] }] });
    const response = await app.request("/webhooks/meta-whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": await hmac(body) }, body }, env);
    assert.equal(response.status, 200);
    assert.equal(queue.length, 1);
    const batch = { messages: queue.map((item) => ({ body: item.body, attempts: 1, timestamp: new Date(), ack: () => { item.acked = true; }, retry: () => assert.fail("pre-0042 queue item should not retry") })) } as unknown as MessageBatch<import("../../../../src/domain/messaging/inbound-queue-contract").GHLInboundQueueEnvelope>;
    const handlers = new Map([["meta_whatsapp", (event: Parameters<ReturnType<typeof createMetaWhatsAppInboundHandler>>[0], bindings: AppBindings) => processMetaWhatsAppInboundEvent(event, bindings.DB, new IntegrationEventService(new IntegrationEventRepository(bindings.DB)), bindings, async ({ value }) => { published.push(String(value.providerMessageId)); })]]);
    await consumeGHLInboundQueue(batch, env, undefined, undefined, handlers);
    assert.deepEqual(published, ["pre42-inbound-1"]);
    assert.equal(queue[0]?.acked, true);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM messaging_messages WHERE tenant_id='pre42-tenant'").get()?.count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='meta_whatsapp_legacy_approval_reviews'").get()?.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

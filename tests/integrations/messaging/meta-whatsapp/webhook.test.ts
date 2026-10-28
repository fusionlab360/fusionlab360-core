import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { verifyMetaSignature } from "../../../../src/integrations/messaging/meta-whatsapp/signature";
import { parseMetaInboundText, parseMetaStatusEvents } from "../../../../src/integrations/messaging/meta-whatsapp/webhook";
import { MetaWhatsAppConnectionRepository } from "../../../../src/integrations/messaging/meta-whatsapp/persistence/connection-repository";
import { metaWhatsAppWebhookController } from "../../../../src/integrations/messaging/meta-whatsapp/webhook-controller";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const filename of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
    }
  }
  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => { values = bindings; return statement; },
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }),
      first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }),
    };
    return statement as unknown as D1PreparedStatement;
  }
  binding(): D1Database { return this as unknown as D1Database; }
}

test("Meta signature accepts the exact raw body and rejects modifications", async () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const secret = "synthetic-app-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const signature = `sha256=${Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  assert.equal(await verifyMetaSignature(body, signature, secret), true);
  assert.equal(await verifyMetaSignature(`${body} `, signature, secret), false);
  assert.equal(await verifyMetaSignature(body, undefined, secret), false);
});

test("Meta text payload normalizes without exposing provider payload to the Queue contract", () => {
  const messages = parseMetaInboundText({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-1" },
      messages: [{ id: "wamid-1", from: "60123456789", timestamp: "1700000000", type: "text", text: { body: "hello" } }],
    } }] }],
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].provider, "meta_whatsapp");
  assert.equal(messages[0].channel, "whatsapp");
  assert.equal(messages[0].phoneNumberId, "phone-1");
  assert.equal(messages[0].text, "hello");
});

test("Meta delivery statuses remain distinct from inbound text events", () => {
  const statuses = parseMetaStatusEvents({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-1" },
      statuses: [{ id: "wamid-1", status: "delivered", timestamp: "1700000000" }],
    } }] }],
  });
  assert.deepEqual(statuses.map((status) => ({ id: status.providerMessageId, status: status.status })), [{ id: "wamid-1", status: "delivered" }]);
});

test("Meta phone-number ownership is tenant scoped and unique", async () => {
  const db = new SQLiteD1();
  db.sqlite.exec("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B')");
  db.sqlite.exec("INSERT INTO integrations (id, tenant_id, provider) VALUES ('integration-a', 'tenant-a', 'meta_whatsapp'), ('integration-b', 'tenant-b', 'meta_whatsapp')");
  const repository = new MetaWhatsAppConnectionRepository(db.binding());
  assert.equal(await repository.createPending({ id: "connection-a", tenantId: "tenant-a", integrationId: "integration-a", wabaId: "waba-a", phoneNumberId: "phone-a" }), true);
  assert.equal(await repository.createPending({ id: "connection-b", tenantId: "tenant-b", integrationId: "integration-b", wabaId: "waba-b", phoneNumberId: "phone-a" }), false);
  assert.equal((await repository.findActiveByPhoneNumberId("phone-a")), null);
});

function webhookBody(phoneNumberId = "phone-a") {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: "wamid-controller-1", from: "60123456789", timestamp: "1700000000", type: "text", text: { body: "hello" } }],
  } }] }] });
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function controllerFixture(
  newEnvelopeEnabled = true,
  send?: (value: Record<string, unknown>, queue: Array<Record<string, unknown>>) => Promise<void>,
  metaGhlInboundEnabled = false,
) {
  const db = new SQLiteD1();
  db.sqlite.exec("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'); INSERT INTO integrations (id, tenant_id, provider) VALUES ('integration-a', 'tenant-a', 'meta_whatsapp'); INSERT INTO meta_whatsapp_connections (id, tenant_id, integration_id, waba_id, phone_number_id, status) VALUES ('connection-a', 'tenant-a', 'integration-a', 'waba-a', 'phone-a', 'active');");
  const queue: Array<Record<string, unknown>> = [];
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.all("/webhooks/meta-whatsapp", metaWhatsAppWebhookController);
  const env = {
    DB: db.binding(),
    META_WHATSAPP_APP_SECRET: "synthetic-secret",
    META_WHATSAPP_VERIFY_TOKEN: "verify-me",
    ...(newEnvelopeEnabled ? { NEW_QUEUE_ENVELOPES_ENABLED: "true" } : {}),
    ...(metaGhlInboundEnabled ? {
      META_WHATSAPP_GHL_INBOUND_ENABLED: "true",
      META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST: "tenant-a",
    } : {}),
    GHL_INBOUND_QUEUE: {
      send: async (value: Record<string, unknown>) => {
        if (send) return send(value, queue);
        queue.push(value);
      },
    },
  } as unknown as AppBindings;
  return { app, env, queue, db };
}

test("Meta webhook can dispatch only the explicitly allowlisted tenant without enabling global queue envelopes", async () => {
  const fixture = controllerFixture(false, undefined, true);
  const body = webhookBody();
  const response = await fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers: { "X-Hub-Signature-256": await sign(body, "synthetic-secret") }, body },
    fixture.env,
  );
  assert.equal(response.status, 200);
  assert.equal(fixture.queue.length, 1);
});

test("Meta webhook persists a durable event without publishing a new envelope while the gate is off", async () => {
  const fixture = controllerFixture(false);
  const body = webhookBody();
  const response = await fixture.app.request("/webhooks/meta-whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": await sign(body, "synthetic-secret") }, body }, fixture.env);
  assert.equal(response.status, 200);
  assert.equal(fixture.queue.length, 0);
  assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM integration_events").get()?.count, 1);
});

test("Meta webhook verifies GET, rejects unknown phone numbers, and queues a durable identity", async () => {
  const fixture = controllerFixture();
  const verified = await fixture.app.request("/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge", {}, fixture.env);
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), "challenge");
  const body = webhookBody();
  const accepted = await fixture.app.request("/webhooks/meta-whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": await sign(body, "synthetic-secret") }, body }, fixture.env);
  assert.equal(accepted.status, 200);
  assert.equal(fixture.queue.length, 1);
  assert.deepEqual(Object.keys(fixture.queue[0]).sort(), ["kind", "sourceEventId", "tenantId", "version"]);
  const unknownBody = webhookBody("unknown-phone");
  const unknown = await fixture.app.request("/webhooks/meta-whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": await sign(unknownBody, "synthetic-secret") }, body: unknownBody }, fixture.env);
  assert.equal(unknown.status, 200);
  assert.equal(fixture.queue.length, 1);
});

test("duplicate Meta webhook delivery does not enqueue a second event", async () => {
  const fixture = controllerFixture();
  const body = webhookBody();
  const headers = { "X-Hub-Signature-256": await sign(body, "synthetic-secret") };
  await fixture.app.request("/webhooks/meta-whatsapp", { method: "POST", headers, body }, fixture.env);
  await fixture.app.request("/webhooks/meta-whatsapp", { method: "POST", headers, body }, fixture.env);
  assert.equal(fixture.queue.length, 1);
});

test("a duplicate Meta webhook re-enqueues a received event after Queue publication fails", async () => {
  let sends = 0;
  const fixture = controllerFixture(true, async (value, queue) => {
    sends += 1;
    if (sends === 1) throw new Error("synthetic Queue publication failure");
    queue.push(value);
  });
  const body = webhookBody();
  const headers = { "X-Hub-Signature-256": await sign(body, "synthetic-secret") };

  const first = await fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers, body },
    fixture.env,
  );
  assert.equal(first.status, 503);
  assert.equal(fixture.queue.length, 0);
  assert.equal(
    fixture.db.sqlite.prepare("SELECT processing_status FROM integration_events").get()?.processing_status,
    "received",
  );
  assert.equal(
    fixture.db.sqlite.prepare("SELECT last_error_code FROM integration_events").get()?.last_error_code,
    "QUEUE_ENQUEUE_FAILED",
  );

  const retried = await fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers, body },
    fixture.env,
  );
  assert.equal(retried.status, 200);
  assert.equal(fixture.queue.length, 1);

  const duplicate = await fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers, body },
    fixture.env,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(fixture.queue.length, 1);
});

test("concurrent Meta webhook deliveries cannot publish the same pending event twice", async () => {
  let releaseQueuePublication: (() => void) | undefined;
  let queuePublicationStarted: (() => void) | undefined;
  const publicationStarted = new Promise<void>((resolve) => { queuePublicationStarted = resolve; });
  const fixture = controllerFixture(true, async (value, queue) => {
    queuePublicationStarted?.();
    await new Promise<void>((resolve) => { releaseQueuePublication = resolve; });
    queue.push(value);
  });
  const body = webhookBody();
  const headers = { "X-Hub-Signature-256": await sign(body, "synthetic-secret") };

  const first = fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers, body },
    fixture.env,
  );
  await publicationStarted;
  const duplicate = await fixture.app.request(
    "/webhooks/meta-whatsapp",
    { method: "POST", headers, body },
    fixture.env,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(fixture.queue.length, 0);

  releaseQueuePublication?.();
  assert.equal((await first).status, 200);
  assert.equal(fixture.queue.length, 1);
});

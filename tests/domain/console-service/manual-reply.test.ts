import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { SignJWT } from "jose";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import routes from "../../../src/domain/console-service/routes";
import { createApplication } from "../../../src/bootstrap/routes";
import consoleApi from "../../../../fusionlab360-console/console-api/src/index";
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

async function fixture(permissions = ["messaging:send"], withGrant = true): Promise<{ db: LocalD1; key: string }> {
  const db = new LocalD1();
  const key = "fl360_manual_reply_test_key";
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES ('tenant-a','Synthetic A','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('integration-a','tenant-a','gohighlevel',1);
    INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id) VALUES ('tenant-a','gohighlevel','api_key','synthetic-ghl-token','location-a');
    INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES ('console-client','tenant-a','Console', '${await hashApiKey(key)}', 'active', '${JSON.stringify(permissions)}');
    INSERT INTO console_service_clients(client_id) VALUES ('console-client');
    INSERT INTO console_service_idempotency(client_id,idempotency_key,request_hash,tenant_id,tenant_name) VALUES ('console-client','bootstrap','hash','tenant-a','Synthetic A');
    ${withGrant ? "INSERT INTO client_tenant_grants(client_id,tenant_id,grant_scope) VALUES ('console-client','tenant-a','messaging:send');" : ""}
  `);
  return { db, key };
}

function app(): Hono<{ Bindings: AppBindings; Variables: AppVariables }> {
  const application = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  application.route("/internal/console", routes);
  return application;
}

function environment(db: LocalD1): AppBindings {
  return {
    DB: db.binding(),
    MANUAL_REPLY_ENABLED: "true",
    GHL_OAUTH_CLIENT_ID: "synthetic-client",
    GHL_OAUTH_CLIENT_SECRET: "synthetic-secret",
  } as AppBindings;
}

test("authorized manual GHL reply reaches the mocked provider once and is idempotent", async () => {
  const { db, key } = await fixture();
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/conversations/search")) {
      return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", locationId: "location-a", type: "WhatsApp" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/conversations/messages")) {
      sends += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-ghl-token");
      return new Response(JSON.stringify({ conversationId: "conversation-a", messageId: "ghl-out-1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected synthetic URL: ${url}`);
  };
  try {
    const request = () => app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Synthetic reply", idempotencyKey: "reply-1" }),
    }, environment(db));
    const first = await request();
    assert.equal(first.status, 202, await first.clone().text());
    assert.equal((await first.json() as { deliveryState: string }).deliveryState, "accepted");
    const second = await request();
    assert.equal(second.status, 202);
    assert.equal(sends, 1);
    assert.equal(db.sqlite.prepare("SELECT status FROM messaging_outbound_deliveries").get()?.status, "sent");
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("manual reply remains disabled without the explicit server flag", async () => {
  const { db, key } = await fixture();
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "must not send", idempotencyKey: "reply-disabled" }),
    }, { ...environment(db), MANUAL_REPLY_ENABLED: "false" });
    assert.equal(response.status, 503);
  } finally { db.sqlite.close(); }
});

test("missing messaging:send permission and tenant grant are denied", async () => {
  const denied = await fixture(["messaging:read"]);
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${denied.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "must not send", idempotencyKey: "reply-denied" }),
    }, environment(denied.db));
    assert.equal(response.status, 403);
  } finally { denied.db.sqlite.close(); }
});

test("a service with messaging:send but no tenant grant is denied", async () => {
  const denied = await fixture(["messaging:send"], false);
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${denied.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "must not send", idempotencyKey: "reply-no-grant" }),
    }, environment(denied.db));
    assert.equal(response.status, 403);
  } finally { denied.db.sqlite.close(); }
});

test("forged conversation identifiers fail before provider delivery", async () => {
  const { db, key } = await fixture();
  let sends = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/conversations/search")) return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", locationId: "location-a", type: "WhatsApp" }] }), { status: 200 });
    sends += 1;
    return new Response(JSON.stringify({ conversationId: "conversation-a", messageId: "should-not-send" }), { status: 200 });
  };
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/forged/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "must not send", idempotencyKey: "reply-forged" }),
    }, environment(db));
    assert.equal(response.status, 422);
    assert.equal(sends, 0);
  } finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
});

test("provider failure is fenced as unknown and never reported as sent", async () => {
  const { db, key } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/conversations/search")) return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", locationId: "location-a", type: "WhatsApp" }] }), { status: 200 });
    throw new Error("synthetic transport failure");
  };
  try {
    const response = await app().request("/internal/console/tenants/tenant-a/ghl/conversations/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "uncertain", idempotencyKey: "reply-unknown" }),
    }, environment(db));
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { deliveryState: string }).deliveryState, "unknown");
    assert.equal(db.sqlite.prepare("SELECT status FROM messaging_outbound_deliveries").get()?.status, "unknown");
  } finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
});

test("Console API manual reply reaches injected Core provider through the HTTP boundary", async () => {
  const { db: coreDb, key: serviceKey } = await fixture();
  const originalFetch = globalThis.fetch;
  const consoleSecret = "console-http-test-secret";
  const consoleDb = {
    prepare(sql: string) {
      const statement = {
        bind(..._values: unknown[]) { return statement; },
        async first<T>() {
          if (sql.includes("FROM console_users")) {
            return {
              id: "member-user",
              email: "member@example.test",
              password_hash: "synthetic",
              first_name: "Synthetic",
              last_name: "Member",
              platform_role: "none",
              active: 1,
              email_verified: 1,
            } as T;
          }
          if (sql.includes("FROM console_memberships")) {
            return { user_id: "member-user", tenant_id: "tenant-a", role: "company_admin", status: "active", permissions: "[\"messaging:send\"]" } as T;
          }
          return null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  const providerSends: Array<{ text: string; conversationId: string }> = [];
  const adapterRequests: string[] = [];
  const provider = {
    async getRecentMessages() { return []; },
    async sendText(_context: unknown, input: { text: string; conversationId: string }) {
      providerSends.push({ text: input.text, conversationId: input.conversationId });
      return { conversationId: input.conversationId, messageId: "ghl-http-provider-message" };
    },
  };
  const core = createApplication("development", undefined, provider);
  const accessToken = await new SignJWT({ tenantId: "tenant-a", platformRole: "none" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("member-user")
    .setIssuer("fusionlab360-console")
    .setAudience("fusionlab360-console")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(consoleSecret));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://core.test/")) {
      const target = new URL(url);
      return core.request(`${target.pathname}${target.search}`, {
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      }, {
        DB: coreDb.binding(),
        MANUAL_REPLY_ENABLED: "true",
        JWT_SECRET: "core-http-test-secret",
        JWT_ISSUER: "fusionlab360-core",
        JWT_AUDIENCE: "fusionlab360-core",
        GHL_OAUTH_CLIENT_ID: "synthetic-client",
        GHL_OAUTH_CLIENT_SECRET: "synthetic-secret",
      } as AppBindings);
    }
    if (url.includes("/conversations/search")) {
      adapterRequests.push(url);
      return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", locationId: "location-a", type: "WhatsApp" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected synthetic URL: ${url}`);
  };
  try {
    const request = (text: string, idempotencyKey: string) => consoleApi.request("/company/ghl/inbox/conversation-a/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, idempotencyKey }),
    }, {
      DB: consoleDb,
      JWT_SECRET: consoleSecret,
      CORE_API_BASE_URL: "http://core.test",
      CORE_SERVICE_TOKEN: serviceKey,
      APP_ENVIRONMENT: "test",
    });
    const first = await request("HTTP synthetic reply", "http-reply-1");
    assert.equal(first.status, 202, await first.clone().text());
    assert.deepEqual(await first.json(), {
      success: true,
      deliveryState: "accepted",
      providerMessageId: "ghl-http-provider-message",
      conversationId: "conversation-a",
    });
    const duplicate = await request("HTTP synthetic reply", "http-reply-1");
    assert.equal(duplicate.status, 202);
    assert.equal(providerSends.length, 1);
    const conflict = await request("different body", "http-reply-1");
    assert.equal(conflict.status, 409);
    assert.equal(adapterRequests.length, 3);
    assert.ok(adapterRequests.every((url) => url.includes("/conversations/search")));
  } finally {
    globalThis.fetch = originalFetch;
    coreDb.sqlite.close();
  }
});

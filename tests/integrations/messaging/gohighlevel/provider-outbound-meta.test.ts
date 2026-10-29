import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { Tenant } from "../../../../src/tenants/types";
import {
  createGHLProviderOutboundController,
  type GHLProviderOutboundPayload,
} from "../../../../src/integrations/messaging/gohighlevel/provider-outbound";
import {
  deliverGHLProviderOutboundToMeta,
  GHLMetaOutboundFailure,
  GHL_META_OUTBOUND_LOCATION,
  GHL_META_OUTBOUND_PHONE_NUMBER_ID,
  GHL_META_OUTBOUND_PROVIDER,
  GHL_META_OUTBOUND_RECIPIENT,
  GHL_META_OUTBOUND_TENANT,
} from "../../../../src/integrations/messaging/gohighlevel/provider-outbound-meta";
import { MetaWhatsAppOutboundError } from "../../../../src/integrations/messaging/meta-whatsapp/outbound";
import { ApiError } from "../../../../src/core/errors/ApiError";

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
  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}

function tenant(overrides: { id?: string; locationId?: string; providerId?: string } = {}): Tenant {
  return {
    id: overrides.id ?? GHL_META_OUTBOUND_TENANT,
    name: "Pilot",
    status: "active",
    integrations: {
      crm: {
        id: "ghl-integration",
        provider: "gohighlevel",
        credentials: { locationId: overrides.locationId ?? GHL_META_OUTBOUND_LOCATION },
        configuration: {
          workflow: {} as never,
          attributeMappings: [],
          providerConfiguration: { conversationProviderId: overrides.providerId ?? GHL_META_OUTBOUND_PROVIDER },
        },
      },
      pms: { provider: "browser" },
    },
  };
}

const payload: GHLProviderOutboundPayload = {
  contactId: "ghl-contact",
  locationId: GHL_META_OUTBOUND_LOCATION,
  messageId: "ghl-agent-message",
  type: "SMS",
  message: "agent reply",
  phone: GHL_META_OUTBOUND_RECIPIENT,
  userId: "ghl-agent",
};

function seedBridge(db: LocalD1): void {
  db.sqlite.exec(`
    INSERT INTO tenants(id,name,status) VALUES ('${GHL_META_OUTBOUND_TENANT}','Pilot','active');
    INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES ('meta-integration','${GHL_META_OUTBOUND_TENANT}','meta_whatsapp',1);
    INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status)
      VALUES ('meta-connection','${GHL_META_OUTBOUND_TENANT}','meta-integration','test-waba','${GHL_META_OUTBOUND_PHONE_NUMBER_ID}','active');
    INSERT INTO messaging_connections(id,tenant_id,provider,integration_id,external_id,status)
      VALUES ('meta-connection','${GHL_META_OUTBOUND_TENANT}','meta_whatsapp','meta-integration','${GHL_META_OUTBOUND_PHONE_NUMBER_ID}','active');
    INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id,channel)
      VALUES ('meta-conversation','${GHL_META_OUTBOUND_TENANT}','meta_whatsapp','meta-connection','${GHL_META_OUTBOUND_RECIPIENT}','whatsapp');
  `);
}

test("signed pilot reply resolves the fixed contact, conversation, and Meta destination", async () => {
  const db = new LocalD1();
  try {
    seedBridge(db);
    let sent: Record<string, unknown> | null = null;
    const result = await deliverGHLProviderOutboundToMeta(
      { DB: db.binding(), GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true" } as AppBindings,
      tenant(),
      payload,
      {
        lookupContact: async () => "ghl-contact",
        send: async (input) => { sent = input; return { state: "accepted", providerMessageId: "wamid-out" }; },
      },
    );
    assert.deepEqual(result, { state: "accepted", providerMessageId: "wamid-out" });
    assert.deepEqual(sent, {
      tenantId: GHL_META_OUTBOUND_TENANT,
      connectionId: "meta-connection",
      conversationId: "meta-conversation",
      recipientId: GHL_META_OUTBOUND_RECIPIENT,
      text: "agent reply",
      effectKey: "ghl-provider:ghl-agent-message",
    });
  } finally { db.close(); }
});

test("pilot bridge rejects disabled, cross-tenant, provider, recipient, and echo-like callbacks", async () => {
  const db = new LocalD1();
  try {
    seedBridge(db);
    const enabled = { DB: db.binding(), GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true" } as AppBindings;
    const deps = { lookupContact: async () => "ghl-contact", send: async () => ({ state: "accepted" as const, providerMessageId: "unexpected" }) };
    await assert.rejects(deliverGHLProviderOutboundToMeta({ ...enabled, GHL_META_WHATSAPP_OUTBOUND_ENABLED: "false" }, tenant(), payload, deps));
    await assert.rejects(deliverGHLProviderOutboundToMeta(enabled, tenant({ id: "other" }), payload, deps));
    await assert.rejects(deliverGHLProviderOutboundToMeta(enabled, tenant({ providerId: "other-provider" }), payload, deps));
    await assert.rejects(deliverGHLProviderOutboundToMeta(enabled, tenant(), { ...payload, phone: "+60111111111" }, deps));
    await assert.rejects(deliverGHLProviderOutboundToMeta(enabled, tenant(), { ...payload, userId: undefined }, deps));
    await assert.rejects(deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, { ...deps, lookupContact: async () => "other-contact" }));
  } finally { db.close(); }
});

test("pilot bridge classifies each pre-delivery rejection stage without sensitive details", async () => {
  const db = new LocalD1();
  try {
    seedBridge(db);
    const enabled = { DB: db.binding(), GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true" } as AppBindings;
    const send = async () => ({ state: "accepted" as const, providerMessageId: "unexpected" });
    const assertStage = async (operation: Promise<unknown>, code: string, retryable: boolean) => {
      await assert.rejects(operation, (error: unknown) =>
        error instanceof GHLMetaOutboundFailure && error.code === code && error.retryable === retryable,
      );
    };

    await assertStage(
      deliverGHLProviderOutboundToMeta({ ...enabled, GHL_META_WHATSAPP_OUTBOUND_ENABLED: "false" }, tenant(), payload, { send }),
      "PROVIDER_IDENTITY_REJECTED", false,
    );
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), { ...payload, type: "Email" }, { send }),
      "PROVIDER_PAYLOAD_REJECTED", false,
    );
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), { ...payload, userId: undefined }, { send }),
      "PROVIDER_IDENTITY_REJECTED", false,
    );
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, { lookupContact: async () => { throw new Error("private"); }, send }),
      "GHL_CONTACT_LOOKUP_FAILED", true,
    );
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, { lookupContact: async () => { throw new ApiError(400, "private"); }, send }),
      "GHL_CONTACT_LOOKUP_FAILED", false,
    );
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, { lookupContact: async () => "other-contact", send }),
      "GHL_CONTACT_MISMATCH", false,
    );
    const noConnection = new LocalD1();
    try {
      await assertStage(
        deliverGHLProviderOutboundToMeta({ ...enabled, DB: noConnection.binding() }, tenant(), payload, { send }),
        "META_CONNECTION_UNAVAILABLE", false,
      );
    } finally { noConnection.close(); }
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, {
        lookupContact: async () => "ghl-contact",
        send: async () => { throw new MetaWhatsAppOutboundError("window", "META_CUSTOMER_WINDOW_EXPIRED"); },
      }),
      "META_CUSTOMER_WINDOW_EXPIRED", false,
    );
    db.sqlite.exec("INSERT INTO messaging_conversations(id,tenant_id,provider,connection_id,external_participant_id,channel) VALUES ('meta-conversation-2','gmmetro','meta_whatsapp','meta-connection','0060176177115','whatsapp')");
    await assertStage(
      deliverGHLProviderOutboundToMeta(enabled, tenant(), payload, { lookupContact: async () => "ghl-contact", send }),
      "META_CONVERSATION_NOT_UNIQUE", false,
    );
  } finally { db.close(); }
});

test("controller persists retryable lookup diagnostics and preserves ambiguous credential outcomes", async () => {
  const db = new LocalD1();
  try {
    const createApp = (deliver: NonNullable<Parameters<typeof createGHLProviderOutboundController>[0]>["deliver"]) => {
      const controller = createGHLProviderOutboundController({
        verifySignature: async () => true,
        resolveTenant: async () => tenant(),
        deliver,
      });
      const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
      app.post("/callback", controller);
      return app;
    };
    const env = {
      DB: db.binding(), GHL_CUSTOM_PROVIDER_ENABLED: "true",
      GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: GHL_META_OUTBOUND_LOCATION,
      GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true",
    } as AppBindings;
    const retryable = createApp(async () => {
      throw new GHLMetaOutboundFailure("GHL_CONTACT_LOOKUP_FAILED", true, "The GHL contact lookup could not be completed.");
    });
    const retryResponse = await retryable.request("/callback", {
      method: "POST", headers: { "X-GHL-Signature": "verified" }, body: JSON.stringify(payload),
    }, env);
    assert.equal(retryResponse.status, 503);
    const retryEvent = db.sqlite.prepare("SELECT processing_status,last_error_code FROM integration_events").get() as { processing_status: string; last_error_code: string };
    assert.equal(retryEvent.processing_status, "failed");
    assert.equal(retryEvent.last_error_code, "GHL_CONTACT_LOOKUP_FAILED");

    const ambiguous = createApp(async () => ({ state: "unknown" as const, code: "META_CREDENTIAL_UNAVAILABLE" }));
    const ambiguousResponse = await ambiguous.request("/callback", {
      method: "POST", headers: { "X-GHL-Signature": "verified" }, body: JSON.stringify({ ...payload, messageId: "credential-ambiguous" }),
    }, env);
    assert.equal(ambiguousResponse.status, 202);
    assert.equal((await ambiguousResponse.json() as { code?: string }).code, "META_CREDENTIAL_UNAVAILABLE");
  } finally { db.close(); }
});

test("controller requires signature verification and processes duplicate source IDs once", async () => {
  const db = new LocalD1();
  try {
    let deliveries = 0;
    const controller = createGHLProviderOutboundController({
      verifySignature: async () => true,
      resolveTenant: async () => tenant(),
      deliver: async () => { deliveries += 1; return { state: "accepted", providerMessageId: "wamid-out" }; },
    });
    const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
    app.post("/webhooks/gohighlevel/provider-outbound", controller);
    const env = {
      DB: db.binding(),
      GHL_CUSTOM_PROVIDER_ENABLED: "true",
      GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: GHL_META_OUTBOUND_LOCATION,
      GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true",
    } as AppBindings;
    const request = () => app.request("/webhooks/gohighlevel/provider-outbound", {
      method: "POST",
      headers: { "X-GHL-Signature": "verified-by-test-seam", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, env);
    assert.equal((await request()).status, 200);
    const duplicate = await request();
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(deliveries, 1);
  } finally { db.close(); }
});

test("controller preserves retryable, permanent, and ambiguous delivery outcomes", async () => {
  for (const [state, expectedStatus] of [["retryable", 503], ["permanent", 422], ["unknown", 202]] as const) {
    const db = new LocalD1();
    try {
      const controller = createGHLProviderOutboundController({
        verifySignature: async () => true,
        resolveTenant: async () => tenant(),
        deliver: async () => state === "unknown" ? { state, code: "transport_exception" } : { state, code: "provider_rejected" },
      });
      const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
      app.post("/callback", controller);
      const response = await app.request("/callback", {
        method: "POST",
        headers: { "X-GHL-Signature": "verified-by-test-seam" },
        body: JSON.stringify({ ...payload, messageId: `message-${state}` }),
      }, {
        DB: db.binding(), GHL_CUSTOM_PROVIDER_ENABLED: "true",
        GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: GHL_META_OUTBOUND_LOCATION,
        GHL_META_WHATSAPP_OUTBOUND_ENABLED: "true",
      } as AppBindings);
      assert.equal(response.status, expectedStatus);
    } finally { db.close(); }
  }
});

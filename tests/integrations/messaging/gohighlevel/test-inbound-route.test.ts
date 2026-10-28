import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { RequestContext } from "../../../../src/context/types";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import { integrationPilotRoutes } from "../../../../src/domain/integration/routes";

class EventDb {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE integration_events (
        event_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        provider TEXT,
        revision INTEGER,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        external_event_id TEXT,
        idempotency_key TEXT,
        processing_status TEXT NOT NULL DEFAULT 'received',
        processing_attempts INTEGER NOT NULL DEFAULT 0,
        processing_started_at TEXT,
        processed_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        processing_lease_token TEXT,
        processing_lease_expires_at TEXT
      );
      CREATE UNIQUE INDEX idx_test_event_external_identity
        ON integration_events (tenant_id, provider, external_event_id);
      CREATE TABLE integration_event_dead_letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        error_code TEXT NOT NULL,
        error_message TEXT NOT NULL,
        retryable INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      run: async () => ({
        meta: { changes: Number(this.sqlite.prepare(sql).run(...bindings as never[]).changes) },
      }),
      first: async <T>() => (
        (this.sqlite.prepare(sql).get(...bindings as never[]) as T | undefined) ?? null
      ),
      all: async <T>() => ({
        results: this.sqlite.prepare(sql).all(...bindings as never[]) as T[],
      }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}

function createApp(
  permissions: string[],
  options: {
    db?: EventDb;
    runtime?: unknown;
    providerConfiguration?: Record<string, unknown>;
  } = {},
) {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    const tenantId = "gmmetro";
    c.set("context", {
      client: { id: "client-gmmetro", tenantId, permissions },
      tenant: {
        id: tenantId,
        name: tenantId,
        status: "active",
        integrations: {
          crm: {
            id: "gmmetro-crm",
            provider: "gohighlevel",
            credentials: { locationId: "Npx2IdDDRjXz2QW3Svx4" },
            configuration: options.providerConfiguration
              ? { workflow: {}, attributeMappings: [], providerConfiguration: options.providerConfiguration }
              : null,
          },
          pms: { provider: "browser" },
        },
      },
      requestId: "request-test",
      receivedAt: new Date(),
      integrationRuntime: options.runtime ?? {},
    } as unknown as RequestContext);
    c.set("principal", {
      type: "client",
      clientId: "client-gmmetro",
      tenantId,
      permissions,
    } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations", integrationPilotRoutes);
  return app;
}

test("controlled test inbound remains closed when the pilot flag is disabled", async () => {
  const app = createApp(["integrations:test"]);
  const response = await app.request(
    "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
    { method: "POST", body: JSON.stringify({ contactId: "synthetic-contact", message: "synthetic", idempotencyKey: "m0-test-1" }) },
    {} as AppBindings,
  );
  assert.equal(response.status, 404);
});
test("controlled test inbound requires the dedicated operator permission", async () => {
  const app = createApp(["integrations:read"]);
  const response = await app.request(
    "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
    { method: "POST", body: JSON.stringify({ contactId: "synthetic-contact", message: "synthetic", idempotencyKey: "m0-test-2" }) },
    { GHL_CUSTOM_PROVIDER_ENABLED: "true", GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4" } as AppBindings,
  );
  assert.equal(response.status, 403);
});

test("transient provider failure can be retried with the same idempotency key", async () => {
  const db = new EventDb();
  let calls = 0;
  const credentials = {
    async resolve() {
      return { authType: "api_key" as const, accessToken: "synthetic-token", resourceId: "Npx2IdDDRjXz2QW3Svx4" };
    },
  };
  const runtime = {
    transportMode: "mock",
    credentials,
    httpTransport: {
      credentials,
      async fetch() {
        calls += 1;
        return calls === 1
          ? new Response("temporary provider outage", { status: 503 })
          : Response.json({ conversationId: "conversation-1", messageId: "message-1" });
      },
    },
  };
  const app = createApp(["integrations:test"], {
    db,
    runtime,
    providerConfiguration: { conversationProviderId: "provider-a" },
  });
  const request = {
    method: "POST",
    body: JSON.stringify({
      contactId: "synthetic-contact",
      message: "synthetic",
      idempotencyKey: "retryable-test-1",
    }),
  } as const;

  try {
    const first = await app.request(
      "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
      request,
      {
        DB: db as unknown as D1Database,
        GHL_CUSTOM_PROVIDER_ENABLED: "true",
        GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4",
      } as AppBindings,
    );
    assert.equal(first.status, 502);
    assert.equal(
      (db.sqlite.prepare("SELECT processing_status, last_error_code FROM integration_events").get() as { processing_status: string; last_error_code: string }).processing_status,
      "failed",
    );
    assert.equal(
      (db.sqlite.prepare("SELECT last_error_code FROM integration_events").get() as { last_error_code: string }).last_error_code,
      "PROVIDER_TRANSIENT",
    );

    const second = await app.request(
      "/integrations/gohighlevel/custom-conversation-provider/test-inbound",
      request,
      {
        DB: db as unknown as D1Database,
        GHL_CUSTOM_PROVIDER_ENABLED: "true",
        GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4",
      } as AppBindings,
    );
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), {
      success: true,
      accepted: true,
      duplicate: true,
      retried: true,
    });
    assert.equal(calls, 2);
    assert.equal(
      (db.sqlite.prepare("SELECT processing_status FROM integration_events").get() as { processing_status: string }).processing_status,
      "processed",
    );
  } finally {
    db.close();
  }
});

test("ambiguous provider failure is terminal and cannot be replayed by duplicate webhook delivery", async () => {
  const db = new EventDb();
  let calls = 0;
  const credentials = {
    async resolve() {
      return { authType: "api_key" as const, accessToken: "synthetic-token", resourceId: "Npx2IdDDRjXz2QW3Svx4" };
    },
  };
  const runtime = {
    transportMode: "mock",
    credentials,
    httpTransport: {
      credentials,
      async fetch() {
        calls += 1;
        throw new Error("transport ended without a confirmed provider outcome");
      },
    },
  };
  const app = createApp(["integrations:test"], {
    db,
    runtime,
    providerConfiguration: { conversationProviderId: "provider-a" },
  });
  const request = {
    method: "POST",
    body: JSON.stringify({
      contactId: "synthetic-contact",
      message: "synthetic",
      idempotencyKey: "ambiguous-test-1",
    }),
  } as const;

  try {
    const env = {
      DB: db as unknown as D1Database,
      GHL_CUSTOM_PROVIDER_ENABLED: "true",
      GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "Npx2IdDDRjXz2QW3Svx4",
    } as AppBindings;
    assert.equal((await app.request("/integrations/gohighlevel/custom-conversation-provider/test-inbound", request, env)).status, 502);
    assert.equal((await app.request("/integrations/gohighlevel/custom-conversation-provider/test-inbound", request, env)).status, 200);
    assert.equal(calls, 1);
    assert.equal(
      (db.sqlite.prepare("SELECT processing_status, last_error_code FROM integration_events").get() as { processing_status: string; last_error_code: string }).processing_status,
      "dead_letter",
    );
    assert.equal(
      (db.sqlite.prepare("SELECT last_error_code FROM integration_events").get() as { last_error_code: string }).last_error_code,
      "OUTBOUND_DELIVERY_UNKNOWN",
    );
  } finally {
    db.close();
  }
});
// End of focused route test.

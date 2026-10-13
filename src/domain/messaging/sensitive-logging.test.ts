import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import type {
  IntegrationContext,
} from "../../context/integration";
import type {
  CanonicalInboundMessage,
} from "../../canonical/message";
import type {
  AIProvider,
} from "../../core/ai";
import type {
  MessagingProvider,
} from "../../core/messaging";
import type {
  KnowledgeRetriever,
} from "./inbound-service";

import {
  loadTenantAIInstructions,
} from "../ai/instruction-service";
import {
  processGHLInboundMessage,
} from "./inbound-service";
import {
  ghlInboundMessageController,
} from "./webhook-controller";
import {
  createInboundCorrelationId,
  traceInboundOperation,
} from "./inbound-diagnostics";

async function captureLogs<T>(
  action: () => Promise<T>,
): Promise<{ result: T; output: string }> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const entries: unknown[][] = [];
  const capture = (...args: unknown[]) => entries.push(args);

  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;

  try {
    const result = await action();
    return {
      result,
      output: JSON.stringify(entries),
    };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test("rejected webhook logs safe metadata but never its raw body", async () => {
  const privateBodyText =
    "WEBHOOK_PRIVATE_SENTINEL customer-phone=+60123456789";
  const app = new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();
  app.post("/inbound", ghlInboundMessageController);

  const { result: response, output } = await captureLogs(async () =>
    await app.request(
      "/inbound",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "MessageCreate",
          message: privateBodyText,
        }),
      },
      {} as AppBindings,
    ),
  );

  assert.equal(response.status, 401);
  assert.match(output, /2026-10-14-inbound-lifecycle-01/);
  assert.equal(output.includes("2026-10-07-oauth-knowledge-01"), false);
  assert.match(output, /GHL WEBHOOK RECEIVED/);
  assert.match(output, /bodyLength/);
  assert.equal(output.includes(privateBodyText), false);
  assert.equal(output.includes("+60123456789"), false);
});

function createInboundTestDatabase(): D1Database {
  return {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

test("inbound history diagnostics omit customer and human message text", async () => {
  const privateMessageText =
    "INBOUND_PRIVATE_SENTINEL account-password=not-for-logs";
  const db = createInboundTestDatabase();
  const context = {
    tenant: { id: "tenant-test", name: "Test Tenant" },
  } as unknown as IntegrationContext;
  const message = {
    provider: "gohighlevel",
    providerMessageId: "message-test",
    locationId: "location-test",
    conversationId: "conversation-test",
    contactId: "contact-test",
    channel: "sms",
    text: privateMessageText,
    occurredAt: "2026-10-12T10:00:00.000Z",
  } as CanonicalInboundMessage;
  const messaging = {
    async getRecentMessages() {
      return [
        {
          id: "human-message-test",
          conversationId: message.conversationId,
          contactId: message.contactId,
          direction: "outbound",
          senderType: "human",
          text: privateMessageText,
          timestamp: "2026-10-12T09:59:00.000Z",
        },
      ];
    },
  } as unknown as MessagingProvider;

  const { output } = await captureLogs(() =>
    processGHLInboundMessage(
      db,
      context,
      {} as AIProvider,
      messaging,
      message,
      {} as KnowledgeRetriever,
    ),
  );

  assert.match(output, /AI SESSION HISTORY DIAGNOSTIC/);
  assert.match(output, /historyCount/);
  assert.equal(output.includes(privateMessageText), false);
  assert.equal(output.includes("INBOUND_PRIVATE_SENTINEL"), false);
  assert.equal(output.includes("account-password"), false);
});

test("tenant instruction diagnostics omit instruction content", async () => {
  const privateInstruction =
    "INSTRUCTION_PRIVATE_SENTINEL escalation-key=do-not-log";
  const sourceRow = {
    id: "source-test",
    tenant_id: "tenant-test",
    provider: "gohighlevel",
    provider_source_id: "provider-source-test",
    name: "AI Agent Instructions",
    description: null,
    metadata: null,
    raw_payload: null,
    source_created_at: null,
    source_updated_at: null,
    synced_at: null,
    status: "active",
    created_at: "2026-10-12T00:00:00.000Z",
    updated_at: "2026-10-12T00:00:00.000Z",
  };
  const documentRow = {
    id: "document-test",
    tenant_id: "tenant-test",
    provider: "gohighlevel",
    knowledge_source_id: "source-test",
    provider_document_id: "provider-document-test",
    source_type: "rich_text",
    title: "Instructions",
    content: privateInstruction,
    source_url: null,
    mime_type: "text/plain",
    metadata: null,
    raw_payload: null,
    content_hash: null,
    source_created_at: null,
    source_updated_at: null,
    source_deleted_at: null,
    synced_at: null,
    status: "active",
    created_at: "2026-10-12T00:00:00.000Z",
    updated_at: "2026-10-12T00:00:00.000Z",
  };
  const db = {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          return {
            results: query.includes("FROM knowledge_sources")
              ? [sourceRow]
              : [documentRow],
          };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;

  const { result: instructions, output } = await captureLogs(() =>
    loadTenantAIInstructions(db, "tenant-test"),
  );

  assert.equal(instructions, privateInstruction);
  assert.match(output, /AI AGENT INSTRUCTIONS LOADED/);
  assert.match(output, /instructionLength/);
  assert.equal(output.includes(privateInstruction), false);
  assert.equal(output.includes("escalation-key"), false);
});

test("lifecycle checkpoints use hashed correlation and omit source IDs and exception text", async () => {
  const privateSourceId = "PRIVATE_SOURCE_ID_customer-12345";
  const privateError = "PRIVATE_PROVIDER_RESPONSE customer=Alice token=secret";
  const correlationId = await createInboundCorrelationId(privateSourceId);

  const { output } = await captureLogs(async () => {
    await traceInboundOperation("knowledge_retrieval", correlationId, async () => "private retrieval result");
    await assert.rejects(
      traceInboundOperation("llm_request", correlationId, async () => {
        throw new Error(privateError);
      }),
    );
  });

  assert.match(output, /operation.*llm_request/);
  assert.match(output, /operation.*knowledge_retrieval/);
  assert.match(output, /phase.*start/);
  assert.match(output, /phase.*complete/);
  assert.match(output, /phase.*failed/);
  assert.match(output, /classification.*unknown/);
  assert.match(output, /elapsedMs/);
  assert.match(output, /ghl-in-[0-9a-f]{24}/);
  assert.equal(output.includes(privateSourceId), false);
  assert.equal(output.includes(privateError), false);
});

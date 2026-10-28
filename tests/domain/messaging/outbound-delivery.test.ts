import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationContext } from "../../../src/context/integration";
import type { MessagingProvider } from "../../../src/core/messaging";
import { ApiError } from "../../../src/core/errors/ApiError";
import { IntegrationEventProcessingError } from "../../../src/core/events/errors";
import { withDurableOutboundDelivery } from "../../../src/domain/messaging/outbound-delivery";

interface DeliveryRow {
  id: string;
  tenant_id: string;
  event_id: string;
  effect_key: string;
  payload_hash: string;
  status: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  provider_message_id: string | null;
  provider_conversation_id: string | null;
}

class OutboxMemoryDatabase {
  row: DeliveryRow | null = null;

  prepare(sql: string) {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      first: async () => this.row,
      run: async () => {
        if (sql.includes("INSERT OR IGNORE")) {
          if (!this.row) {
            this.row = {
              id: String(bindings[0]),
              tenant_id: String(bindings[1]),
              event_id: String(bindings[2]),
              effect_key: String(bindings[4]),
              payload_hash: String(bindings[6]),
              status: "pending",
              lease_token: null,
              lease_expires_at: null,
              provider_message_id: null,
              provider_conversation_id: null,
            };
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes("SET status = 'sending'")) {
          if (this.row?.status === "pending") {
            this.row.status = "sending";
            this.row.lease_token = String(bindings[0]);
            this.row.lease_expires_at = String(bindings[1]);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes("SET status = 'sent'")) {
          if (this.row?.status === "sending" && this.row.lease_token === bindings[5]) {
            this.row.status = "sent";
            this.row.provider_message_id = String(bindings[0]);
            this.row.provider_conversation_id = String(bindings[1]);
            this.row.lease_token = null;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes("SET status = 'unknown'")) {
          if (this.row?.status === "sending" && this.row.lease_token === bindings[4]) {
            this.row.status = "unknown";
            this.row.lease_token = null;
          }
          return { meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'failed'")) {
          if (this.row?.status === "sending" && this.row.lease_token === bindings[4]) {
            this.row.status = "failed";
            this.row.lease_token = null;
          }
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return statement;
  }
}

const context = {
  tenant: { id: "tenant-1" },
  provider: "gohighlevel",
} as IntegrationContext;

const input = {
  conversationId: "conversation-1",
  contactId: "contact-1",
  text: "Reply content must remain private.",
  channel: "sms",
};

function provider(sendText: MessagingProvider["sendText"]): MessagingProvider {
  return {
    async getRecentMessages() { return []; },
    sendText,
  };
}

test("confirmed outbound delivery is returned from the ledger on redelivery", async () => {
  const db = new OutboxMemoryDatabase();
  let sends = 0;
  const wrapped = withDurableOutboundDelivery(
    db as unknown as D1Database,
    provider(async () => {
      sends += 1;
      return { messageId: "provider-message-1", conversationId: "conversation-1" };
    }),
    "event-1",
    async () => true,
  );

  const first = await wrapped.sendText(context, input);
  const redelivered = withDurableOutboundDelivery(
    db as unknown as D1Database,
    provider(async () => {
      sends += 1;
      return { messageId: "unexpected", conversationId: "conversation-1" };
    }),
    "event-1",
    async () => true,
  );
  const second = await redelivered.sendText(context, input);

  assert.deepEqual(first, second);
  assert.equal(sends, 1);
  assert.equal(db.row?.status, "sent");
});

test("ambiguous outbound failure is marked unknown and never resent", async () => {
  const db = new OutboxMemoryDatabase();
  let sends = 0;
  const firstAttempt = withDurableOutboundDelivery(
    db as unknown as D1Database,
    provider(async () => {
      sends += 1;
      throw new Error("sensitive provider response must not escape");
    }),
    "event-2",
    async () => true,
  );

  await assert.rejects(
    firstAttempt.sendText(context, input),
    /outcome is unknown/i,
  );
  const retry = withDurableOutboundDelivery(
    db as unknown as D1Database,
    provider(async () => {
      sends += 1;
      return { messageId: "duplicate", conversationId: "conversation-1" };
    }),
    "event-2",
    async () => true,
  );

  await assert.rejects(retry.sendText(context, input), /outcome is unknown/i);
  assert.equal(sends, 1);
  assert.equal(db.row?.status, "unknown");
});

test("a definitive provider rejection is terminal instead of an ambiguous delivery", async () => {
  const db = new OutboxMemoryDatabase();
  const wrapped = withDurableOutboundDelivery(
    db as unknown as D1Database,
    provider(async () => {
      throw new ApiError(400, "Provider rejected the request.");
    }),
    "event-3",
    async () => true,
  );

  await assert.rejects(
    wrapped.sendText(context, input),
    (error: unknown) => error instanceof IntegrationEventProcessingError &&
      error.code === "PROVIDER_REQUEST_REJECTED" &&
      error.retryable === false,
  );
  assert.equal(db.row?.status, "failed");
});

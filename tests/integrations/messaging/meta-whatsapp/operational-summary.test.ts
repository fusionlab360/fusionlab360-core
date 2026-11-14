import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database } from "@cloudflare/workers-types";
import { evaluateMetaWhatsAppOperationalAlerts, readMetaWhatsAppOperationalSummary } from "../../../../src/integrations/messaging/meta-whatsapp/operational-summary";
import { deliverMetaWhatsAppOperationalAlerts } from "../../../../src/integrations/messaging/meta-whatsapp/operational-alerts";

test("operational aggregates are scoped to the authenticated tenant and contain counts only", async () => {
  const bindings: unknown[][] = [];
  const db = { prepare(sql: string) {
    assert.match(sql.trim(), /^SELECT/);
    assert.doesNotMatch(sql, /text_content|access_token|refresh_token|recipient_id/i);
    return { bind(...values: unknown[]) {
      bindings.push(values);
      return { first: async () => {
        const count = values[0] === "tenant_a" ? 2 : 0;
        if (sql.includes("FROM integration_events")) return { total: count, dead_letter: 0, retried: 0, backlog: 0, failures: 0, correlation_failures: 0 };
        if (sql.includes("FROM messaging_outbound_deliveries")) return { total: count, sent: count, failed: 0, unknown: 0 };
        if (sql.includes("FROM integration_event_dead_letters")) return { total: 0 };
        if (sql.includes("FROM meta_whatsapp_credentials")) return { expiring: 0 };
        throw new Error("unexpected query");
      } };
    } };
  } } as unknown as D1Database;
  const a = await readMetaWhatsAppOperationalSummary(db, "tenant_a");
  const b = await readMetaWhatsAppOperationalSummary(db, "tenant_b");
  assert.equal(a.events.total, 2);
  assert.equal(b.events.total, 0);
  assert.equal(a.deliveries.sent, 2);
  assert.equal(b.deliveries.sent, 0);
  assert.equal(bindings.length, 8);
  assert.ok(bindings.slice(0, 4).every((values) => values[0] === "tenant_a"));
  assert.ok(bindings.slice(4).every((values) => values[0] === "tenant_b"));
  assert.doesNotMatch(JSON.stringify(a), /message|recipient|token|credential_value/i);
});

test("alerts stay disabled without an explicit flag and sink", async () => {
  const summary = { events: { total: 2, deadLetter: 1, retried: 1, backlog: 2, failures: 1, correlationFailures: 1 },
    deliveries: { total: 2, sent: 0, failed: 1, unknown: 1 }, deadLetters: 1, credentialsExpiringWithin24Hours: 1 };
  assert.deepEqual(evaluateMetaWhatsAppOperationalAlerts(summary, { enabled: "false", backlog: "1" }), []);
  assert.deepEqual(evaluateMetaWhatsAppOperationalAlerts(summary, { enabled: "true", backlog: "2", failures: "2" }), ["INBOUND_BACKLOG", "OUTBOUND_FAILURES"]);
  assert.equal(await deliverMetaWhatsAppOperationalAlerts({ enabled: false, tenantId: "tenant_a", codes: ["INBOUND_BACKLOG"], periodStartUtc: "2026-11-05T00:00:00.000Z" }), 0);
});

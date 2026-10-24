import assert from "node:assert/strict";
import test from "node:test";
import { searchGHLConversations } from "../../src/integrations/messaging/gohighlevel/conversations";
import type { IntegrationContext } from "../../src/context/integration";

function context(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): IntegrationContext {
  return {
    tenant: { id: "tenant-a", name: "Synthetic", status: "active", integrations: { crm: { id: "crm-a", provider: "gohighlevel", credentials: { locationId: "location-a" }, configuration: null }, pms: { provider: "browser" } } },
    provider: "gohighlevel",
    requestId: "request-a",
    receivedAt: new Date(),
    integrationRuntime: { transportMode: "mock" as const, credentials: { resolve: async () => ({ authType: "api_key" as const, accessToken: "synthetic-token", resourceId: "location-a" }) }, httpTransport: { fetch: fetcher, credentials: { resolve: async () => ({ authType: "api_key" as const, accessToken: "synthetic-token", resourceId: "location-a" }) } } },
  };
}

test("GHL conversation search uses the tenant Location and normalizes summaries", async () => {
  let requested = ""; let version = "";
  const result = await searchGHLConversations(context(async (input, init) => { requested = String(input); version = new Headers(init?.headers).get("Version") ?? ""; return new Response(JSON.stringify({ conversations: [{ id: "conversation-a", contactId: "contact-a", type: "TYPE_LIVE_CHAT", lastMessageBody: "Hello", lastMessageDate: "2026-10-24T00:00:00.000Z" }], meta: { nextPage: 2 } }), { status: 200, headers: { "content-type": "application/json" } }); }), { limit: 10, page: 1 });
  assert.match(requested, /\/conversations\/search\?locationId=location-a&limit=10&page=1/);
  assert.equal(version, "v3");
  assert.equal(result.items[0].externalConversationId, "conversation-a");
  assert.equal(result.items[0].externalParticipantId, "contact-a");
  assert.equal(result.nextPage, 2);
});

test("GHL conversation search rejects malformed provider envelopes", async () => {
  await assert.rejects(() => searchGHLConversations(context(async () => new Response(JSON.stringify({ conversations: "invalid" }), { status: 200 }))), /invalid response|conversation search/i);
});

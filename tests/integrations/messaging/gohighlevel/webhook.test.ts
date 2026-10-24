import assert from "node:assert/strict";
import test from "node:test";
import { parseGHLInboundMessage } from "../../../../src/integrations/messaging/gohighlevel/webhook";

const valid = {
  type: "InboundMessage",
  locationId: "location-a",
  contactId: "contact-a",
  conversationId: "conversation-a",
  messageId: "message-a",
  body: "hello",
  direction: "inbound",
  dateAdded: "2026-01-01T00:00:00.000Z",
  messageType: "WhatsApp",
  conversationProviderId: "provider-a",
};

test("GHL inbound normalization preserves verified conversation and channel identities", () => {
  assert.deepEqual(parseGHLInboundMessage(valid), {
    provider: "gohighlevel",
    providerMessageId: "message-a",
    locationId: "location-a",
    conversationId: "conversation-a",
    contactId: "contact-a",
    channel: "whatsapp",
    channelProviderId: "provider-a",
    text: "hello",
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
});
test("GHL normalization rejects missing identities, outbound events, and non-text payloads", () => {
  assert.equal(parseGHLInboundMessage({ ...valid, messageId: "" }), null);
  assert.equal(parseGHLInboundMessage({ ...valid, direction: "outbound" }), null);
  assert.equal(parseGHLInboundMessage({ ...valid, contentType: "image/jpeg" }), null);
});

test("unsupported GHL message types remain provider-specific custom channel data", () => {
  const message = parseGHLInboundMessage({ ...valid, messageType: "FutureProviderType" });
  assert.equal(message?.channel, "custom");
  assert.equal(message?.text, "hello");
});

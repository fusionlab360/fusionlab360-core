import assert from "node:assert/strict";
import test from "node:test";
import { KnownNonDeliveryError } from "../../../../src/core/messaging";
import { goHighLevelMessagingProvider } from "../../../../src/integrations/messaging/gohighlevel/provider";
import type { IntegrationContext } from "../../../../src/context/integration";

const context = {} as IntegrationContext;

test("unsupported GHL channels fail before provider submission with a known non-delivery error", async () => {
  await assert.rejects(
    goHighLevelMessagingProvider.sendText(context, {
      conversationId: "conversation-1",
      contactId: "contact-1",
      text: "test",
      channel: "unsupported-channel",
    }),
    KnownNonDeliveryError,
  );
});

test("custom GHL messages without a provider ID fail before provider submission", async () => {
  await assert.rejects(
    goHighLevelMessagingProvider.sendText(context, {
      conversationId: "conversation-1",
      contactId: "contact-1",
      text: "test",
      channel: "custom",
    }),
    KnownNonDeliveryError,
  );
});

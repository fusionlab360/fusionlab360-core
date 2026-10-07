import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  testGetConversation,
} from "./test-service";

import {
  resolveMessagingProvider,
} from "../../core/messaging";

import {
  createMessagingIntegrationContext,
} from "./test-service";

export async function testGetConversationController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  const conversationId =
    c.req.param("conversationId");

  if (!conversationId) {
    return c.json(
      {
        success: false,
        message:
          "conversationId is required.",
      },
      400,
    );
  }

  const context =
    c.get("context");

  const messages =
    await testGetConversation(
      context,
      conversationId,
    );

  return c.json({
    success: true,
    count: messages.length,
    messages,
  });
}

export async function testSendMessageController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  const conversationId =
    c.req.param("conversationId");

  if (!conversationId) {
    return c.json(
      {
        success: false,
        message:
          "conversationId is required.",
      },
      400,
    );
  }

  const body =
    await c.req.json<{
      contactId?: string;
      text?: string;
    }>();

  if (
    !body.contactId ||
    !body.text
  ) {
    return c.json(
      {
        success: false,
        message:
          "contactId and text are required.",
      },
      400,
    );
  }

  const requestContext =
    c.get("context");

  const integrationContext =
    createMessagingIntegrationContext(
      requestContext,
    );

  const messaging =
    resolveMessagingProvider(
      integrationContext.provider,
    );

  const result =
    await messaging.sendText(
      integrationContext,
      {
        conversationId,
        contactId:
          body.contactId,
        text:
          body.text,
      },
    );

  return c.json({
    success: true,
    result,
  });
}
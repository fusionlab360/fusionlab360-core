import type {
  RequestContext,
} from "../../context";

import type {
  IntegrationContext,
} from "../../context/integration";

import {
  resolveMessagingProvider,
} from "../../core/messaging";


export function createMessagingIntegrationContext(
  context:
    RequestContext,
): IntegrationContext {

  return {
    tenant:
      context.tenant,

    provider:
      "gohighlevel",

    requestId:
      context.requestId,

    receivedAt:
      context.receivedAt,

    integrationRuntime:
      context.integrationRuntime,
  };
}


export async function testGetConversation(
  context:
    RequestContext,

  conversationId:
    string,
) {

  const integrationContext =
    createMessagingIntegrationContext(
      context,
    );


  const messaging =
    resolveMessagingProvider(
      integrationContext.provider,
    );


  return messaging.getRecentMessages(
    integrationContext,

    conversationId,

    20,
  );
}
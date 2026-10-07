import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";


import type {
  IntegrationContext,
} from "../../../context/integration";


export interface GHLConversationMessage {

  id:
    string;

  altId?:
    string;

  contactId:
    string;

  conversationId:
    string;

  locationId:
    string;

  body?:
    string;

  direction?:
    string;

  dateAdded?:
    string;

  dateUpdated?:
    string;

  messageType?:
    string;

  type?:
    number;

  status?:
    string;

  contentType?:
    string;

  source?:
    string;

  userId?:
    string;

  conversationProviderId?:
    string;

  chatWidgetId?:
    string;

  from?:
    string;

  to?:
    string;

  error?:
    string;

  meta?: {

    marketplace?: {

      appId?:
        string;

      appName?:
        string;
    };
  };
}


interface GHLMessagesResponse {

  messages?: {

    lastMessageId?:
      string;

    nextPage?:
      boolean;

    messages?:
      GHLConversationMessage[];
  };
}


/*
 * --------------------------------------------------
 * Get recent messages for a GHL conversation
 * --------------------------------------------------
 *
 * Authentication is resolved through the generic
 * IntegrationContext.
 *
 * This allows the GHL authenticated client to handle:
 *
 * - api_key credentials
 * - OAuth2 credentials
 * - expiry detection
 * - OAuth refresh
 * - D1 refresh locking
 * - one retry after a GHL 401
 */

export async function getConversationMessages(
  context:
    IntegrationContext,

  conversationId:
    string,

  limit =
    20,
): Promise<
  GHLConversationMessage[]
> {

  if (
    !conversationId?.trim()
  ) {

    throw new Error(
      "GoHighLevel conversationId is required.",
    );
  }


  const params =
    new URLSearchParams({

      limit:
        String(
          limit,
        ),

    });


  const response =
    await ghlFetchAuthenticated<
      GHLMessagesResponse
    >(

      context,

      `/conversations/${encodeURIComponent(
        conversationId,
      )}/messages?${params.toString()}`,

      {

        headers: {

          Version:
            "v3",
        },
      },
    );


  return (
    response
      .messages
      ?.messages ??
    []
  );
}
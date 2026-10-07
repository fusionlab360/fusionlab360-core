import type {
  MessagingProvider,
  MessagingChannel,
  MessagingSenderType,
} from "../../../core/messaging";


import type {
  IntegrationContext,
} from "../../../context/integration";


import {
  getConversationMessages,
} from "./messages";


import {
  sendTextMessage,
  type GHLMessageType,
} from "./send";


/*
 * --------------------------------------------------
 * Resolve canonical channel to GHL message type
 * --------------------------------------------------
 */

function resolveGHLMessageType(
  channel:
    MessagingChannel |
    undefined,
):
  GHLMessageType {

  const normalized =
    channel
      ?.trim()
      .toLowerCase();


  switch (
    normalized
  ) {

    case "whatsapp":

      return "WhatsApp";


    case "sms":

      return "SMS";


    case "email":

      return "Email";


    case "live_chat":

    case "live-chat":

    case "livechat":

      return "Live_Chat";


    case "instagram":

    case "ig":

      return "IG";


    case "facebook":

    case "fb":

      return "FB";


    case "custom":

      return "Custom";


    default:

      throw new Error(
        `Unsupported GHL messaging channel: ${
          channel ??
          "undefined"
        }`,
      );
  }
}


/*
 * --------------------------------------------------
 * Resolve GHL historical message sender
 * --------------------------------------------------
 *
 * HighLevel exposes message source and userId.
 *
 * Core converts those provider-specific signals into
 * the provider-neutral senderType.
 *
 * This prevents GHL workflow/system messages from
 * being blindly presented to the AI as assistant text.
 */

function resolveGHLSenderType(
  message: {
    direction?:
      string;

    source?:
      string;

    userId?:
      string;

    type?:
      number;

    messageType?:
      string;

    meta?: {

      marketplace?: {

        appId?:
          string;

        appName?:
          string;
      };
    };
  },
):
  MessagingSenderType {

  const direction =
    (
      message.direction ??
      ""
    )
      .trim()
      .toLowerCase();


  const messageType =
    (
      message.messageType ??
      ""
    )
      .trim()
      .toUpperCase();


  /*
   * -----------------------------------------------
   * Customer
   * -----------------------------------------------
   */

  if (
    direction ===
    "inbound"
  ) {

    return "customer";
  }


  /*
   * -----------------------------------------------
   * GHL Live Chat informational/system message
   * -----------------------------------------------
   *
   * Observed in the real conversation:
   *
   * type: 30
   * messageType:
   * TYPE_LIVE_CHAT_INFO_MESSAGE
   *
   * Examples:
   *
   * "Your chat has ended"
   * "Chat closed due to user inactivity"
   * "Please share contact details"
   */

  if (
    message.type ===
      30 ||

    messageType ===
      "TYPE_LIVE_CHAT_INFO_MESSAGE"
  ) {

    return "system";
  }


  /*
   * -----------------------------------------------
   * FusionLab360 AI
   * -----------------------------------------------
   *
   * Observed real payload:
   *
   * source: app
   * meta.marketplace.appName:
   * "FusionLab360 AI"
   */

  const marketplaceAppName =
    (
      message
        .meta
        ?.marketplace
        ?.appName ??
      ""
    )
      .trim()
      .toLowerCase();


  if (
    marketplaceAppName ===
      "fusionlab360 ai"
  ) {

    return "ai";
  }


  /*
   * -----------------------------------------------
   * Human/team outbound message
   * -----------------------------------------------
   *
   * For normal TYPE_LIVE_CHAT outbound messages
   * without the FusionLab360 AI marketplace marker,
   * treat the sender as a human/team member.
   */

  if (
    direction ===
      "outbound" &&

    (
      message.type ===
        29 ||

      messageType ===
        "TYPE_LIVE_CHAT"
    )
  ) {

    return "human";
  }


  /*
   * -----------------------------------------------
   * Unknown
   * -----------------------------------------------
   */

  return "unknown";
}


/*
 * --------------------------------------------------
 * Resolve GHL historical message channel
 * --------------------------------------------------
 */

function resolveGHLHistoryChannel(
  messageType:
    string |
    undefined,
):
  MessagingChannel |
  undefined {

  const normalized =
    (
      messageType ??
      ""
    )
      .trim()
      .toLowerCase();


  if (
    normalized.includes(
      "whatsapp",
    )
  ) {

    return "whatsapp";
  }


  if (
    normalized.includes(
      "live_chat",
    ) ||

    normalized.includes(
      "livechat",
    ) ||

    normalized.includes(
      "webchat",
    )
  ) {

    return "live_chat";
  }


  if (
    normalized.includes(
      "sms",
    )
  ) {

    return "sms";
  }


  if (
    normalized.includes(
      "email",
    )
  ) {

    return "email";
  }


  if (
    normalized.includes(
      "instagram",
    )
  ) {

    return "instagram";
  }


  if (
    normalized.includes(
      "facebook",
    )
  ) {

    return "facebook";
  }


  if (
    normalized.includes(
      "custom",
    )
  ) {

    return "custom";
  }


  return undefined;
}


/*
 * --------------------------------------------------
 * GoHighLevel Messaging Provider
 * --------------------------------------------------
 */

export const goHighLevelMessagingProvider:
  MessagingProvider = {


  /*
   * ------------------------------------------------
   * Get recent conversation messages
   * ------------------------------------------------
   */

  async getRecentMessages(
    context:
      IntegrationContext,

    conversationId:
      string,

    limit =
      20,
  ) {

    const messages =
      await getConversationMessages(
        context,

        conversationId,

        limit,
      );


    return messages.map(
      (
        message,
      ) => ({

        id:
          message.id,


        conversationId:
          message.conversationId,


        contactId:
          message.contactId,


        direction:
          message.direction ??
          "",


        text:
          message.body ??
          "",


        timestamp:
          message.dateAdded ??
          "",


        /*
         * ------------------------------------------
         * Provider-neutral sender classification
         * ------------------------------------------
         */

        senderType:
          resolveGHLSenderType(
            message,
          ),


        /*
         * ------------------------------------------
         * Generic sender identifier
         * ------------------------------------------
         */

        senderId:
          message.userId
            ?.trim() ||
          undefined,


        /*
         * ------------------------------------------
         * Preserve generic source
         * ------------------------------------------
         */

        source:
          message.source
            ?.trim() ||
          undefined,


        /*
         * ------------------------------------------
         * Preserve provider message type
         * ------------------------------------------
         */

        providerMessageType:
          message.messageType
            ?.trim() ||
          undefined,


        /*
         * ------------------------------------------
         * Resolve historical channel
         * ------------------------------------------
         */

        channel:
          resolveGHLHistoryChannel(
            message.messageType,
          ),


        /*
         * ------------------------------------------
         * Preserve custom provider identity
         * ------------------------------------------
         */

        channelProviderId:
          message.conversationProviderId
            ?.trim() ||
          undefined,
      }),
    );
  },


  /*
   * ------------------------------------------------
   * Send text message
   * ------------------------------------------------
   */

  async sendText(
    context:
      IntegrationContext,

    input,
  ) {

    const type =
      resolveGHLMessageType(
        input.channel,
      );


    /*
     * Custom Conversation Provider validation.
     */

    if (
      type ===
        "Custom" &&

      !input.channelProviderId
        ?.trim()
    ) {

      throw new Error(
        "GoHighLevel Custom message requires channelProviderId.",
      );
    }


    /*
     * ------------------------------------------------
     * Runtime-aware authenticated GHL request
     * ------------------------------------------------
     *
     * IMPORTANT:
     *
     * Do not extract credentials.apiKey here.
     *
     * sendTextMessage() receives the full
     * IntegrationContext and resolves the current
     * credential through ghlFetchAuthenticated().
     *
     * This enables:
     *
     * - OAuth2 expiry detection
     * - automatic refresh
     * - D1 refresh locking
     * - 401 retry
     */

    const response =
      await sendTextMessage(
        context,

        {
          type,

          contactId:
            input.contactId,

          message:
            input.text,

          conversationId:
            input.conversationId,

          replyMessageId:
            input.replyMessageId,

          conversationProviderId:
            type ===
              "Custom"

              ? input.channelProviderId

              : undefined,
        },
      );


    /*
     * ------------------------------------------------
     * Validate normalized GHL response
     * ------------------------------------------------
     */

    if (
      !response.conversationId
    ) {

      throw new Error(
        "GoHighLevel did not return conversationId.",
      );
    }


    if (
      !response.messageId
    ) {

      throw new Error(
        "GoHighLevel did not return messageId.",
      );
    }


    return {

      conversationId:
        response.conversationId,

      messageId:
        response.messageId,
    };
  },
};
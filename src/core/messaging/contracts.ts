import type {
  IntegrationContext,
} from "../../context/integration";


/*
 * --------------------------------------------------
 * Generic messaging channel
 * --------------------------------------------------
 */

export type MessagingChannel =
  | "whatsapp"
  | "sms"
  | "email"
  | "live_chat"
  | "custom"
  | string;


/*
 * --------------------------------------------------
 * Generic sender type
 * --------------------------------------------------
 *
 * Provider-neutral classification.
 */

export type MessagingSenderType =
  | "customer"
  | "ai"
  | "human"
  | "system"
  | "unknown";


/*
 * --------------------------------------------------
 * Generic messaging message
 * --------------------------------------------------
 */

export interface MessagingMessage {

  id:
    string;

  conversationId:
    string;

  contactId:
    string;

  direction:
    | "inbound"
    | "outbound"
    | string;

  text:
    string;

  timestamp:
    string;


  /*
   * Provider-neutral sender classification.
   */

  senderType?:
    MessagingSenderType;


  /*
   * Optional sender identifier.
   */

  senderId?:
    string;


  /*
   * Provider-neutral source indicator.
   */

  source?:
    string;


  /*
   * Raw provider message type retained for
   * adapter diagnostics and future normalization.
   */

  providerMessageType?:
    string;


  channel?:
    MessagingChannel;


  channelProviderId?:
    string;
}


/*
 * --------------------------------------------------
 * Outbound messaging input
 * --------------------------------------------------
 */

export interface MessagingReplyInput {

  conversationId:
    string;

  contactId:
    string;

  text:
    string;

  channel?:
    MessagingChannel;

  channelProviderId?:
    string;

  replyMessageId?:
    string;
}


/*
 * --------------------------------------------------
 * Messaging provider contract
 * --------------------------------------------------
 */

export interface MessagingProvider {

  getRecentMessages(
    context:
      IntegrationContext,

    conversationId:
      string,

    limit?:
      number,
  ): Promise<
    MessagingMessage[]
  >;


  sendText(
    context:
      IntegrationContext,

    input:
      MessagingReplyInput,
  ): Promise<{

    conversationId:
      string;

    messageId:
      string;
  }>;
}
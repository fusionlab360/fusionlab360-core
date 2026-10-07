import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";


import type {
  IntegrationContext,
} from "../../../context/integration";


/*
 * --------------------------------------------------
 * GoHighLevel message types
 * --------------------------------------------------
 *
 * These are provider-specific and therefore remain
 * inside the GHL integration.
 */

export type GHLMessageType =
  | "SMS"
  | "Email"
  | "WhatsApp"
  | "IG"
  | "FB"
  | "Custom"
  | "Live_Chat";


/*
 * --------------------------------------------------
 * GHL outbound message input
 * --------------------------------------------------
 */

export interface GHLSendMessageInput {

  type:
    GHLMessageType;

  contactId:
    string;

  message:
    string;

  conversationId?:
    string;

  replyMessageId?:
    string;

  conversationProviderId?:
    string;
}


/*
 * --------------------------------------------------
 * GHL outbound response
 * --------------------------------------------------
 */

export interface GHLSendMessageResponse {

  conversationId?:
    string;

  messageId?:
    string;

  msg?:
    string;
}


/*
 * --------------------------------------------------
 * Send text message through GoHighLevel
 * --------------------------------------------------
 *
 * Authentication is resolved through the generic
 * IntegrationContext.
 *
 * The caller decides the GHL message type.
 *
 * Examples:
 *
 * WhatsApp
 * SMS
 * Email
 * Live_Chat
 * Custom
 *
 * For Custom messages, conversationProviderId
 * is passed when supplied.
 */

export async function sendTextMessage(
  context:
    IntegrationContext,

  input:
    GHLSendMessageInput,
): Promise<
  GHLSendMessageResponse
> {

  /*
   * ------------------------------------------------
   * 1. Base request payload
   * ------------------------------------------------
   */

  const body:
    Record<
      string,
      unknown
    > = {

      type:
        input.type,

      contactId:
        input.contactId,

      message:
        input.message,
    };


  /*
   * ------------------------------------------------
   * 2. Conversation ID
   * ------------------------------------------------
   */

  if (
    input.conversationId
  ) {

    body.conversationId =
      input.conversationId;
  }


  /*
   * ------------------------------------------------
   * 3. Reply message ID
   * ------------------------------------------------
   */

  if (
    input.replyMessageId
  ) {

    body.replyMessageId =
      input.replyMessageId;
  }


  /*
   * ------------------------------------------------
   * 4. Custom Conversation Provider
   * ------------------------------------------------
   *
   * This is only meaningful for:
   *
   * type = Custom
   *
   * The provider layer is responsible for validating
   * that a Custom message actually contains the
   * required channelProviderId.
   */

  if (
    input.conversationProviderId
  ) {

    body.conversationProviderId =
      input.conversationProviderId;
  }


  /*
   * ------------------------------------------------
   * 5. Send to GHL
   * ------------------------------------------------
   *
   * IMPORTANT:
   *
   * Do not pass credentials.apiKey here.
   *
   * ghlFetchAuthenticated() resolves the current
   * tenant credential and automatically handles:
   *
   * - OAuth2 expiry
   * - refresh
   * - refresh locking
   * - 401 retry
   */

  return ghlFetchAuthenticated<
    GHLSendMessageResponse
  >(
    context,

    "/conversations/messages",

    {
      method:
        "POST",

      headers: {

        Version:
          "v3",
      },

      body:
        JSON.stringify(
          body,
        ),
    },
  );
}
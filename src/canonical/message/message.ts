/*
 * --------------------------------------------------
 * Canonical inbound message
 * --------------------------------------------------
 *
 * Provider-neutral normalized representation of an
 * inbound message.
 *
 * Provider-specific terminology must not leak into
 * this model.
 *
 * Examples:
 *
 * GHL WhatsApp
 * GHL Live_Chat
 * GHL Custom
 * Telegram
 * Messenger
 *
 * can all be normalized into this structure.
 */

export interface CanonicalInboundMessage {

  /*
   * Provider that originated the message.
   */

  provider:
    string;


  /*
   * Provider-specific message identifier.
   */

  providerMessageId:
    string;


  /*
   * Provider-specific location/account identifier.
   */

  locationId:
    string;


  /*
   * Provider conversation identifier.
   */

  conversationId:
    string;


  /*
   * Provider contact identifier.
   */

  contactId:
    string;


  /*
   * Canonical messaging channel.
   *
   * Examples:
   *
   * whatsapp
   * sms
   * email
   * live_chat
   * custom
   */

  channel:
    string;


  /*
   * Optional provider-specific channel identifier.
   *
   * Example:
   *
   * GHL conversationProviderId
   *
   * Core deliberately calls this channelProviderId
   * so the canonical model remains provider-neutral.
   */

  channelProviderId?:
    string;


  /*
   * Normalized message text.
   */

  text:
    string;


  /*
   * Original message timestamp.
   */

  occurredAt:
    string;
}
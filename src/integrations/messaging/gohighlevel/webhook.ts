import type {
  CanonicalInboundMessage,
} from "../../../canonical/message";


/*
 * --------------------------------------------------
 * GoHighLevel inbound message webhook
 * --------------------------------------------------
 *
 * This file is the GHL-specific normalization boundary.
 *
 * GHL provider-specific message types are converted
 * into FusionLab360 canonical messaging channels.
 *
 * Examples:
 *
 * GHL WhatsApp
 *     ↓
 * whatsapp
 *
 * GHL Live_Chat
 *     ↓
 * live_chat
 *
 * GHL Custom
 *     ↓
 * custom
 *
 * GHL conversationProviderId
 *     ↓
 * channelProviderId
 */


/*
 * --------------------------------------------------
 * GHL webhook payload
 * --------------------------------------------------
 */

export interface GHLInboundMessagePayload {

  type?:
    string;

  locationId?:
    string;

  body?:
    string;

  contactId?:
    string;

  contentType?:
    string;

  conversationId?:
    string;

  dateAdded?:
    string;

  direction?:
    string;

  messageType?:
    string;

  messageTypeString?:
    string;

  messageTypeId?:
    number;

  conversationProviderId?:
    string;

  messageId?:
    string;

  status?:
    string;

  userId?:
    string;
}


/*
 * --------------------------------------------------
 * Normalize message type
 * --------------------------------------------------
 */

function normalizeMessageType(
  value:
    string | undefined,
):
  string {

  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_",
      ) ??
    ""
  );
}


/*
 * --------------------------------------------------
 * Detect Custom Provider SMS
 * --------------------------------------------------
 *
 * This is intentionally generic.
 *
 * No tenant ID, subaccount ID, group ID,
 * participant name, or participant phone number
 * is hard-coded.
 */

function isCustomProviderSms(
  messageType:
    string,

  messageTypeString:
    string,
):
  boolean {

  return (
    messageType ===
      "type_custom_provider_sms" ||

    messageType ===
      "custom_provider_sms" ||

    messageTypeString ===
      "type_custom_provider_sms" ||

    messageTypeString ===
      "custom_provider_sms"
  );
}


/*
 * --------------------------------------------------
 * Detect WhatsApp group participant prefix
 * --------------------------------------------------
 *
 * The GHL Custom Provider SMS integration places the
 * group participant identity at the beginning of the
 * message body:
 *
 * 👤 alamea219 (+60172029441)
 *
 * The participant name and phone number are dynamic.
 *
 * This pattern therefore works across:
 *
 * - multiple tenants
 * - multiple GHL subaccounts
 * - multiple WhatsApp groups
 * - different participants
 */

function hasWhatsAppGroupParticipantPrefix(
  text:
    string,
):
  boolean {

  const participantPrefix =
    /^👤\s+.+?\s+\(\+\d{8,15}\)(?:\r?\n|$)/u;


  return participantPrefix.test(
    text.trim(),
  );
}


/*
 * --------------------------------------------------
 * Detect WhatsApp group message
 * --------------------------------------------------
 *
 * We require BOTH:
 *
 * 1. Custom Provider SMS
 *
 * 2. Group participant prefix
 *
 * This prevents normal messages from being blocked
 * simply because they happen to contain an emoji
 * or phone number.
 */

function isLikelyWhatsAppGroupMessage(
  payload:
    GHLInboundMessagePayload,

  text:
    string,

  messageType:
    string,

  messageTypeString:
    string,
):
  boolean {

  if (
    !isCustomProviderSms(
      messageType,

      messageTypeString,
    )
  ) {

    return false;
  }


  return hasWhatsAppGroupParticipantPrefix(
    text,
  );
}


/*
 * --------------------------------------------------
 * Determine canonical channel
 * --------------------------------------------------
 *
 * GHL may provide both:
 *
 * messageType
 * messageTypeString
 *
 * IMPORTANT:
 *
 * A Custom Conversation Provider can have a value such
 * as:
 *
 * messageType:
 *   Custom
 *
 * messageTypeString:
 *   TYPE_CUSTOM_PROVIDER_SMS
 *
 * The word "SMS" in TYPE_CUSTOM_PROVIDER_SMS does NOT
 * mean the message should be routed through native SMS.
 *
 * It is still a Custom Conversation Provider.
 *
 * Therefore Custom Provider detection MUST happen
 * before the generic SMS check.
 */

function resolveCanonicalChannel(
  messageType:
    string,

  messageTypeString:
    string,
):
  "whatsapp"
  | "sms"
  | "email"
  | "live_chat"
  | "custom" {


  /*
   * ------------------------------------------------
   * 1. Custom Provider
   * ------------------------------------------------
   *
   * This check MUST happen first.
   *
   * Example:
   *
   * messageType:
   *   custom
   *
   * messageTypeString:
   *   type_custom_provider_sms
   *
   * Result:
   *
   *   custom
   */

  if (
    isCustomProviderSms(
      messageType,

      messageTypeString,
    )
  ) {

    return "custom";
  }


  /*
   * Also preserve a generic Custom message type.
   */

  if (
    messageType ===
      "custom" ||

    messageTypeString ===
      "custom"
  ) {

    return "custom";
  }


  /*
   * ------------------------------------------------
   * 2. WhatsApp
   * ------------------------------------------------
   */

  if (
    messageType.includes(
      "whatsapp",
    ) ||

    messageTypeString.includes(
      "whatsapp",
    ) ||

    messageType ===
      "type_whatsapp"
  ) {

    return "whatsapp";
  }


  /*
   * ------------------------------------------------
   * 3. Live Chat
   * ------------------------------------------------
   *
   * This is the important mapping for the FusionLab
   * AI subaccount.
   */

  if (
    messageType.includes(
      "live_chat",
    ) ||

    messageType.includes(
      "livechat",
    ) ||

    messageTypeString.includes(
      "live_chat",
    ) ||

    messageTypeString.includes(
      "livechat",
    ) ||

    messageTypeString.includes(
      "webchat",
    ) ||

    messageType ===
      "type_live_chat"
  ) {

    return "live_chat";
  }


  /*
   * ------------------------------------------------
   * 4. SMS
   * ------------------------------------------------
   *
   * This is checked ONLY after Custom Provider
   * detection.
   */

  if (
    messageType ===
      "sms" ||

    messageTypeString ===
      "sms" ||

    messageTypeString ===
      "type_sms"
  ) {

    return "sms";
  }


  /*
   * ------------------------------------------------
   * 5. Email
   * ------------------------------------------------
   */

  if (
    messageType.includes(
      "email",
    ) ||

    messageTypeString.includes(
      "email",
    )
  ) {

    return "email";
  }


  /*
   * ------------------------------------------------
   * 6. Unknown provider type
   * ------------------------------------------------
   *
   * Preserve unknown GHL message types as custom
   * rather than silently pretending they are WhatsApp
   * or SMS.
   */

  return "custom";
}


/*
 * --------------------------------------------------
 * Parse GHL inbound message
 * --------------------------------------------------
 */

export function parseGHLInboundMessage(
  payload:
    GHLInboundMessagePayload,
):
  CanonicalInboundMessage | null {

  /*
   * ------------------------------------------------
   * 1. Event type
   * ------------------------------------------------
   */

  if (
    payload.type &&
    payload.type !==
      "InboundMessage"
  ) {

    return null;
  }


  /*
   * ------------------------------------------------
   * 2. Required identifiers
   * ------------------------------------------------
   */

  const locationId =
    payload.locationId?.trim();


  const contactId =
    payload.contactId?.trim();


  const conversationId =
    payload.conversationId?.trim();


  const messageId =
    payload.messageId?.trim();


  const text =
    payload.body?.trim();


  if (
    !locationId ||
    !contactId ||
    !conversationId ||
    !messageId ||
    !text
  ) {

    return null;
  }


  /*
   * ------------------------------------------------
   * 3. Direction
   * ------------------------------------------------
   *
   * This parser is specifically for inbound messages.
   */

  const direction =
    payload.direction
      ?.trim()
      .toLowerCase();


  if (
    direction &&
    direction !==
      "inbound"
  ) {

    return null;
  }


  /*
   * ------------------------------------------------
   * 4. Normalize message type values
   * ------------------------------------------------
   */

  const messageType =
    normalizeMessageType(
      payload.messageType,
    );


  const messageTypeString =
    normalizeMessageType(
      payload.messageTypeString,
    );


  /*
   * ------------------------------------------------
   * 5. WhatsApp group guard
   * ------------------------------------------------
   *
   * Group messages from the GHL Custom Provider SMS
   * integration contain a participant prefix such as:
   *
   * 👤 Participant Name (+60123456789)
   *
   * These messages are intentionally ignored before
   * they enter the AI/session/RAG pipeline.
   */

  if (
    isLikelyWhatsAppGroupMessage(
      payload,

      text,

      messageType,

      messageTypeString,
    )
  ) {

    return null;
  }


  /*
   * ------------------------------------------------
   * 6. Resolve canonical channel
   * ------------------------------------------------
   */

  const channel =
    resolveCanonicalChannel(
      messageType,

      messageTypeString,
    );


  /*
   * ------------------------------------------------
   * 7. Preserve Custom provider identifier
   * ------------------------------------------------
   *
   * GHL calls this:
   *
   * conversationProviderId
   *
   * FusionLab360 calls it:
   *
   * channelProviderId
   *
   * This remains provider-neutral inside Core.
   */

  const conversationProviderId =
    payload.conversationProviderId
      ?.trim();


  /*
   * ------------------------------------------------
   * 8. Content type
   * ------------------------------------------------
   *
   * Some GHL webhooks omit contentType.
   *
   * When it is present, only process text content.
   */

  const contentType =
    payload.contentType
      ?.trim()
      .toLowerCase();


  if (
    contentType &&
    !contentType.startsWith(
      "text/",
    )
  ) {

    return null;
  }


  /*
   * ------------------------------------------------
   * 9. Canonical message
   * ------------------------------------------------
   */

  return {

    provider:
      "gohighlevel",

    providerMessageId:
      messageId,

    locationId,

    conversationId,

    contactId,

    channel,

    channelProviderId:
      conversationProviderId,

    text,

    occurredAt:
      payload.dateAdded ??
      new Date().toISOString(),
  };
}
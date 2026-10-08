import type {
  IntegrationContext,
} from "../../context/integration";

import type {
  CanonicalInboundMessage,
} from "../../canonical/message";

import type {
  AIProvider,
} from "../../core/ai";

import type {
  MessagingProvider,
} from "../../core/messaging";

import {
  IntegrationEventService,
} from "../../core/events/service";

import {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";

import {
  AIConversationSessionRepository,
} from "../../persistence/repositories/ai-conversation-session-repository";

import {
  AIAgentProfileRepository,
} from "../../persistence/repositories/ai-agent-profile-repository";

import {
  AISessionService,
} from "../ai/session-service";

import {
  AIAgentProfileService,
} from "../ai/profile-service";

import {
  generateAIReply,
  type KnowledgeContextItem,
} from "./ai-chat-service";

import {
  loadTenantAIInstructions,
} from "../ai/instruction-service";

import {
  isHandoffOffer,
} from "./intent-guard";

import {
  resolveKnowledgeQuery,
  type KnowledgeQueryHistoryItem,
} from "./knowledge-query-context";

import {
  calculateAIThinkingDelay,
  calculateAIDeliveryDelay,
  sleep,
} from "./response-timing-service";

import {
  AIBookingSessionRepository,
} from "../../persistence/repositories/ai-booking-session-repository";

import {
  processAIBooking,
} from "../booking/ai-booking-service";

import {
  IntegrationEventDeadLetterRepository,
} from "../../persistence/repositories/integration-event-dead-letter-repository";

/*
 * ----------------------------------------------------------
 * Resolve tenant-configured booking timezone
 * ----------------------------------------------------------
 */

function resolveBookingTimezone(
  context:
    IntegrationContext,
):
  string |
  undefined {

  const providerConfiguration =
    context.tenant.integrations.crm.configuration
      ?.providerConfiguration;

  const candidates =
    [
      providerConfiguration?.bookingTimezone,
      providerConfiguration?.timezone,
      providerConfiguration?.defaultTimezone,
    ];

  const configuredTimezone =
    candidates.find(
      (
        value,
      ) =>
        typeof value ===
          "string" &&
        value.trim().length >
          0,
    );

  return typeof configuredTimezone ===
    "string"
    ? configuredTimezone.trim()
    : undefined;
}

/*
 * ----------------------------------------------------------
 * Detect a newer inbound customer message
 * ----------------------------------------------------------
 */

function hasNewerInboundMessage(
  history:
    Array<{
      id:
        string;

      direction?:
        string;

      timestamp?:
        string |
        null;
    }>,

  currentMessageId:
    string,

  currentOccurredAt:
    string,
):
  boolean {

  const currentMessageTime =
    new Date(
      currentOccurredAt,
    ).getTime();

  return history.some(
    (
      item,
    ) => {

      if (
        item.id ===
        currentMessageId
      ) {

        return false;
      }

      if (
        item.direction !==
        "inbound"
      ) {

        return false;
      }

      const itemTime =
        new Date(
          item.timestamp ??
          "",
        ).getTime();

      return (
        Number.isFinite(
          itemTime,
        ) &&

        Number.isFinite(
          currentMessageTime,
        ) &&

        itemTime >
          currentMessageTime
      );
    },
  );
}

/*
 * ----------------------------------------------------------
 * Detect human agent takeover
 * ----------------------------------------------------------
 *
 * Any outbound message identified as coming from a human
 * means the human has taken control of the conversation.
 *
 * AI-generated outbound messages use senderType "ai" and
 * therefore do not trigger this condition.
 */

function findLatestHumanOutboundMessage(
  history:
    Array<{
      id:
        string;

      direction?:
        string;

      senderType?:
        string;

      timestamp?:
        string |
        null;
    }>,
):
  {
    id:
      string;

    timestamp:
      string;
  } |
  null {

  let latest:
    {
      id:
        string;

      timestamp:
        string;
    } |
    null =
    null;

  for (
    const item of
      history
  ) {

    if (
      item.direction
        ?.trim()
        .toLowerCase() !==
      "outbound"
    ) {

      continue;
    }

    if (
      item.senderType
        ?.trim()
        .toLowerCase() !==
      "human"
    ) {

      continue;
    }

    if (
      !item.timestamp
    ) {

      continue;
    }

    const itemTime =
      new Date(
        item.timestamp,
      ).getTime();

    if (
      !Number.isFinite(
        itemTime,
      )
    ) {

      continue;
    }

    if (
      !latest
    ) {

      latest = {
        id:
          item.id,

        timestamp:
          item.timestamp,
      };

      continue;
    }

    const latestTime =
      new Date(
        latest.timestamp,
      ).getTime();

    if (
      itemTime >
      latestTime
    ) {

      latest = {
        id:
          item.id,

        timestamp:
          item.timestamp,
      };
    }
  }

  return latest;
}

/*
 * ----------------------------------------------------------
 * Detect human takeover after the current AI message began
 * ----------------------------------------------------------
 */

function hasNewerHumanOutboundMessage(
  history:
    Array<{
      id:
        string;

      direction?:
        string;

      senderType?:
        string;

      timestamp?:
        string |
        null;
    }>,

  currentMessageId:
    string,

  currentOccurredAt:
    string,
):
  boolean {

  const currentMessageTime =
    new Date(
      currentOccurredAt,
    ).getTime();

  return history.some(
    (
      item,
    ) => {

      if (
        item.id ===
        currentMessageId
      ) {

        return false;
      }

      if (
        item.direction
          ?.trim()
          .toLowerCase() !==
        "outbound"
      ) {

        return false;
      }

      if (
        item.senderType
          ?.trim()
          .toLowerCase() !==
        "human"
      ) {

        return false;
      }

      const itemTime =
        new Date(
          item.timestamp ??
            "",
        ).getTime();

      return (
        Number.isFinite(
          itemTime,
        ) &&

        Number.isFinite(
          currentMessageTime,
        ) &&

        itemTime >
          currentMessageTime
      );
    },
  );
}

/*
 * ----------------------------------------------------------
 * Knowledge retriever
 * ----------------------------------------------------------
 */

export interface KnowledgeRetriever {

  search(
    query:
      string,
  ): Promise<
    KnowledgeContextItem[]
  >;
}

/*
 * ----------------------------------------------------------
 * Process normalized inbound message
 * ----------------------------------------------------------
 *
 * AI BOOKING IS CONTROLLED BY:
 *
 *     bookingEnabled
 *
 * When false:
 *
 *     - booking session is not loaded
 *     - processAIBooking() is not called
 *     - booking cannot interrupt normal AI
 *     - normal RAG / AI continues
 *
 * When true:
 *
 *     - existing booking behavior is restored
 */

export async function processGHLInboundMessage(

  db:
    D1Database,

  context:
    IntegrationContext,

  ai:
    AIProvider,

  messaging:
    MessagingProvider,

  message:
    CanonicalInboundMessage,

  knowledgeRetriever:
    KnowledgeRetriever,

  /**
   * AI appointment booking feature flag.
   *
   * IMPORTANT:
   *
   * false = booking completely disabled
   * true  = booking enabled
   *
   * Safe default is false.
   */

  bookingEnabled:
    boolean = false,

): Promise<void> {

  /*
   * --------------------------------------------------------
   * 1. Idempotency
   * --------------------------------------------------------
   */

  const eventRepository =
    new IntegrationEventRepository(
      db,
    );

  const eventService =
  new IntegrationEventService(
    eventRepository,

    new IntegrationEventDeadLetterRepository(
      db,
    ),
  );

  const eventResult =
    await eventService.accept({
      eventId:
        message.providerMessageId,

      eventType:
        "messaging.inbound",

      aggregateType:
        "conversation",

      aggregateId:
        message.conversationId,

      tenantId:
        context.tenant.id,

      provider:
        message.provider,

      occurredAt:
        message.occurredAt,

      payload:
        message,
    });

    const claimedForProcessing =
  await eventService.claimForProcessing(
    context.tenant.id,
    message.providerMessageId,
  );

  if (
    !claimedForProcessing
  ) {

    console.log(
      "GHL inbound event is already processed or currently being processed.",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        duplicate:
          eventResult.duplicate,
      },
    );

    return;
  }

 
 let processingSucceeded =
  true;

try {

  /*
   * --------------------------------------------------------
   * 2. Load recent conversation history
   * --------------------------------------------------------
   */

  let history =
    await messaging.getRecentMessages(
      context,
      message.conversationId,
      20,
    );

  /*
   * --------------------------------------------------------
   * 3. Determine previous activity
   * --------------------------------------------------------
   */

  const previousMessages =
    history.filter(
      (
        item,
      ) =>
        item.id !==
        message.providerMessageId,
    );

  console.log(
    "AI SESSION HISTORY DIAGNOSTIC",
    {
      conversationId:
        message.conversationId,

      currentMessageId:
        message.providerMessageId,

      currentMessageAt:
        message.occurredAt,

      historyCount:
        history.length,

      messages:
        history.map(
          (
            item,
          ) => ({
            id:
              item.id,

            timestamp:
              item.timestamp,

            direction:
              item.direction,

            senderType:
              item.senderType,

            text:
              item.text?.slice(
                0,
                100,
              ),
          }),
        ),
    },
  );

  const previousActivityAt =
    previousMessages.reduce<
      string |
      null
    >(
      (
        latest,
        item,
      ) => {

        if (
          !item.timestamp
        ) {

          return latest;
        }

        if (
          !latest
        ) {

          return item.timestamp;
        }

        return (
          new Date(
            item.timestamp,
          ).getTime() >

          new Date(
            latest,
          ).getTime()

            ? item.timestamp
            : latest
        );
      },

      null,
    );

  /*
   * --------------------------------------------------------
   * 4. Load tenant AI profile
   * --------------------------------------------------------
   */

  const profileRepository =
    new AIAgentProfileRepository(
      db,
    );

  const profileService =
    new AIAgentProfileService(
      profileRepository,
    );

  const profile =
    await profileService.getOrCreate(
      context.tenant.id,
      context.tenant.name,
    );

  /*
   * --------------------------------------------------------
   * 5. Resolve AI conversation session
   * --------------------------------------------------------
   */

  const sessionRepository =
    new AIConversationSessionRepository(
      db,
    );

  const sessionService =
    new AISessionService(
      sessionRepository,
    );

  /*
   * --------------------------------------------------------
   * HUMAN TAKEOVER ALREADY PRESENT
   * --------------------------------------------------------
   *
   * If the conversation history already contains a real
   * human outbound message, AI must not take control.
   *
   * This catches a human reply that arrived before the
   * current customer message was processed.
   */

  const latestHumanOutbound =
    findLatestHumanOutboundMessage(
      history,
    );

  if (
    latestHumanOutbound
  ) {

    const existingSession =
      await sessionRepository.find(
        context.tenant.id,
        message.provider,
        message.conversationId,
      );

    await sessionRepository.upsert(
      context.tenant.id,
      message.provider,
      message.conversationId,
      "human_handoff",
      existingSession?.sessionStartedAt ??
        latestHumanOutbound.timestamp ??
        message.occurredAt,
    );

    console.log(
      "AI HUMAN TAKEOVER - AI PROCESSING STOPPED",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        customerMessageId:
          message.providerMessageId,

        humanMessageId:
          latestHumanOutbound.id,

        humanMessageAt:
          latestHumanOutbound.timestamp,
      },
    );

    return;
  }

  const decision =
    await sessionService.handleInbound({

      tenantId:
        context.tenant.id,

      provider:
        message.provider,

      conversationId:
        message.conversationId,

      messageText:
        message.text,

      occurredAt:
        message.occurredAt,

      previousActivityAt,

      profile,
    });

  console.log(
    "AI SESSION DECISION",
    {
      tenantId:
        context.tenant.id,

      provider:
        message.provider,

      conversationId:
        message.conversationId,

      messageId:
        message.providerMessageId,

      action:
        decision.action,

      state:
        decision.state,
    },
  );

  /*
   * --------------------------------------------------------
   * AI BOOKING FEATURE FLAG
   * --------------------------------------------------------
   *
   * IMPORTANT:
   *
   * Do NOT load booking state when disabled.
   *
   * This prevents an old/stale booking session from
   * hijacking the normal AI conversation.
   */

  const bookingSessionRepository =
    bookingEnabled
      ? new AIBookingSessionRepository(
          db,
        )
      : null;

  const activeBookingSession =
    bookingEnabled &&
    bookingSessionRepository
      ? await bookingSessionRepository.find(
          context.tenant.id,
          message.provider,
          message.conversationId,
        )
      : null;

  const bookingSessionActive =
    Boolean(
      activeBookingSession &&

      activeBookingSession.status !==
        "confirmed" &&

      activeBookingSession.status !==
        "cancelled",
    );

  const confirmedBookingActionRequested =
  Boolean(
    activeBookingSession &&

    activeBookingSession.status ===
      "confirmed" &&

    /(?:cancel|cancelled|cancellation|reschedule|re-schedule|change\s+my\s+(?:appointment|booking)|move\s+my\s+(?:appointment|booking))/i.test(
      message.text,
    ),
  );

  const confirmedBookingActionPending =
  Boolean(
    activeBookingSession &&

    activeBookingSession.status ===
      "confirmed" &&

    (() => {

      if (
        !activeBookingSession.dataJson
      ) {

        return false;
      }


      try {

        const data =
          JSON.parse(
            activeBookingSession.dataJson,
          );


        return (
          data &&
          typeof data ===
            "object" &&

          (
            data.pendingCancellation ===
              true ||

            data.pendingReschedule ===
              true ||

            data.pendingRescheduleConfirmation ===
              true
          )
        );

      } catch {

        return false;
      }

    })(),
  );


  if (
    !bookingEnabled
  ) {

    console.log(
      "AI BOOKING INTEGRATION DISABLED",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        reason:
          "AI_BOOKING_ENABLED is not true.",
      },
    );

  }

  /*
   * Only log booking session state when booking
   * is actually enabled.
   */

  if (
    bookingEnabled
  ) {

    console.log(
      "AI BOOKING SESSION STATE",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        bookingSessionActive,

        bookingSessionStatus:
          activeBookingSession?.status ??
          null,
      },
    );

  }

  /*
   * --------------------------------------------------------
   * 6. HUMAN HANDOFF
   * --------------------------------------------------------
   */

  if (
    decision.action ===
    "handoff"
  ) {

    if (
      decision.response?.trim()
    ) {

      await messaging.sendText(
        context,
        {
          conversationId:
            message.conversationId,

          contactId:
            message.contactId,

          text:
            decision.response.trim(),

          channel:
            message.channel,

          channelProviderId:
            message.channelProviderId,
        },
      );
    }

    return;
  }

  /*
   * --------------------------------------------------------
   * 7. HUMAN-CONTROLLED CONVERSATION
   * --------------------------------------------------------
   */

  if (
  decision.action ===
    "ignore" &&

  !bookingSessionActive &&

  !confirmedBookingActionRequested &&

  !confirmedBookingActionPending
) {



    return;
  }

  /*
   * --------------------------------------------------------
   * 8. AI SESSION
   * --------------------------------------------------------
   */

 if (
  decision.action !==
    "ai" &&

  !bookingSessionActive &&

  !confirmedBookingActionRequested &&

  !confirmedBookingActionPending
) {
    return;
  }

  /*
   * --------------------------------------------------------
   * Natural AI thinking window
   * --------------------------------------------------------
   */

  const thinkingDelay =
    calculateAIThinkingDelay();

  console.log(
    "AI thinking delay",
    {
      tenantId:
        context.tenant.id,

      conversationId:
        message.conversationId,

      delayMs:
        thinkingDelay,
    },
  );

  await sleep(
    thinkingDelay,
  );

  /*
   * --------------------------------------------------------
   * Reload latest conversation history
   * --------------------------------------------------------
   */

  const latestHistory =
    await messaging.getRecentMessages(
      context,
      message.conversationId,
      20,
    );

  /*
   * --------------------------------------------------------
   * Detect newer customer message
   * --------------------------------------------------------
   */

  const newerInboundMessage =
    hasNewerInboundMessage(
      latestHistory,
      message.providerMessageId,
      message.occurredAt,
    );

  if (
    newerInboundMessage
  ) {

    console.log(
      "AI response deferred because a newer customer message arrived.",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,
      },
    );

    return;
  }

  /*
   * --------------------------------------------------------
   * Use latest history for AI generation
   * --------------------------------------------------------
   */

  history =
    latestHistory;

  /*
   * --------------------------------------------------------
   * 9. AI BOOKING ENGINE
   * --------------------------------------------------------
   *
   * CRITICAL:
   *
   * processAIBooking() is ONLY called when:
   *
   *     bookingEnabled === true
   *
   * When false, execution jumps directly to RAG.
   */

  if (
    bookingEnabled
  ) {

    try {

      const bookingResult =
        await processAIBooking({
          db,

          context,

          ai,

          history,

          currentMessage:
            message.text,

          occurredAt:
            message.occurredAt,

          conversationId:
            message.conversationId,

          customerId:
            message.contactId,

          timezone:
            resolveBookingTimezone(
              context,
            ),
        });

      

      console.log(
        "AI BOOKING ENGINE RESULT",
        {
          tenantId:
            context.tenant.id,

          provider:
            message.provider,

          conversationId:
            message.conversationId,

          messageId:
            message.providerMessageId,

          handled:
            bookingResult.handled,

          state:
            bookingResult.state,

          action:
            bookingResult.intent.action,

          bookingType:
            bookingResult.intent.bookingType,

          sessionStatus:
            bookingResult.session?.status ??
            null,
        },
      );

      if (
        bookingResult.handled &&

        bookingResult.message?.trim()
      ) {

        const bookingReply =
          bookingResult.message.trim();

        /*
         * Check again before starting delivery delay.
         */

        const latestBeforeBookingDelivery =
          await messaging.getRecentMessages(
            context,
            message.conversationId,
            20,
          );

        if (
          hasNewerInboundMessage(
            latestBeforeBookingDelivery,
            message.providerMessageId,
            message.occurredAt,
          )
        ) {

          console.log(
            "AI booking response suppressed because a newer customer message arrived.",
            {
              tenantId:
                context.tenant.id,

              provider:
                message.provider,

              conversationId:
                message.conversationId,

              messageId:
                message.providerMessageId,
            },
          );

          return;
        }

        /*
         * Same natural delivery timing used by normal AI.
         */

        const bookingDeliveryDelay =
          calculateAIDeliveryDelay(
            bookingReply,
          );

        console.log(
          "AI BOOKING DELIVERY DELAY",
          {
            tenantId:
              context.tenant.id,

            provider:
              message.provider,

            conversationId:
              message.conversationId,

            delayMs:
              bookingDeliveryDelay,

            responseLength:
              bookingReply.length,
          },
        );

        await sleep(
          bookingDeliveryDelay,
        );

        /*
         * Final stale-message check.
         */

        const latestBeforeBookingSend =
          await messaging.getRecentMessages(
            context,
            message.conversationId,
            20,
          );

        const newerBookingInboundMessage =
          hasNewerInboundMessage(
            latestBeforeBookingSend,
            message.providerMessageId,
            message.occurredAt,
          );

        const bookingHumanTakeover =
          hasNewerHumanOutboundMessage(
            latestBeforeBookingSend,
            message.providerMessageId,
            message.occurredAt,
          );

        if (
          bookingHumanTakeover
        ) {

          const latestHumanOutbound =
            findLatestHumanOutboundMessage(
              latestBeforeBookingSend,
            );

          const existingSession =
            await sessionRepository.find(
              context.tenant.id,
              message.provider,
              message.conversationId,
            );

          await sessionRepository.upsert(
            context.tenant.id,
            message.provider,
            message.conversationId,
            "human_handoff",
            existingSession?.sessionStartedAt ??
              latestHumanOutbound?.timestamp ??
              message.occurredAt,
          );

          console.log(
            "AI BOOKING RESPONSE SUPPRESSED - HUMAN TAKEOVER",
            {
              tenantId:
                context.tenant.id,

              provider:
                message.provider,

              conversationId:
                message.conversationId,

              messageId:
                message.providerMessageId,

              humanMessageId:
                latestHumanOutbound?.id ??
                null,

              humanMessageAt:
                latestHumanOutbound?.timestamp ??
                null,
            },
          );

          return;
        }

        if (
          newerBookingInboundMessage
        ) {

          console.log(
            "AI booking response suppressed during delivery because a newer customer message arrived.",
            {
              tenantId:
                context.tenant.id,

              provider:
                message.provider,

              conversationId:
                message.conversationId,

              messageId:
                message.providerMessageId,
            },
          );

          return;
        }

        await messaging.sendText(
          context,
          {
            conversationId:
              message.conversationId,

            contactId:
              message.contactId,

            text:
              bookingReply,

            channel:
              message.channel,

            channelProviderId:
              message.channelProviderId,
          },
        );

        /*
         * Booking handled this inbound event.
         * Do not continue into RAG.
         */

        return;
      }

    } catch (
      error:
        unknown
    ) {

      console.error(
        "AI BOOKING ENGINE FAILED",
        {
          tenantId:
            context.tenant.id,

          provider:
            message.provider,

          conversationId:
            message.conversationId,

          messageId:
            message.providerMessageId,

          error:
            error instanceof Error
              ? error.message
              : error,
        },
      );

      /*
       * An active booking transaction must not fall
       * through to generic RAG/AI after a booking failure.
       */

      if (
        bookingSessionActive
      ) {

        await messaging.sendText(
          context,
          {
            conversationId:
              message.conversationId,

            contactId:
              message.contactId,

            text:
              "I’m sorry, I’m having trouble completing the booking right now. Please try again in a moment.",

            channel:
              message.channel,

            channelProviderId:
              message.channelProviderId,
          },
        );

        return;
      }

      /*
       * No active booking session:
       * continue into normal RAG/AI.
       */

    }

  }

  /*
   * --------------------------------------------------------
   * 10. Retrieve approved knowledge
   * --------------------------------------------------------
   */

  let knowledge:
    KnowledgeContextItem[] =
    [];

  try {

    /*
     * --------------------------------------------------------
     * Build contextual retrieval query
     * --------------------------------------------------------
     *
     * The retrieval query may include the previous customer
     * topic for short follow-up messages.
     *
     * Previous AI answers are never used as factual evidence.
     * --------------------------------------------------------
     */

    const retrievalHistory:
      KnowledgeQueryHistoryItem[] =
      history
        .filter(
          (
            item,
          ) =>
            item.id !==
              message.providerMessageId &&

            item.text?.trim().length > 0,
        )
        .map(
          (
            item,
          ) => ({
            role:
              item.senderType ===
              "customer"
                ? "customer"
                : item.senderType ===
                    "human"
                  ? "human"
                  : "ai",

            text:
              item.text,
          }),
        );

    const knowledgeQuery =
      resolveKnowledgeQuery(
        message.text,
        retrievalHistory,
        message.occurredAt,
      );

    console.log(
      "AI CONTEXTUAL KNOWLEDGE QUERY",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        originalQuery:
          knowledgeQuery.originalQuery,

        retrievalQuery:
          knowledgeQuery.retrievalQuery,

        contextUsed:
          knowledgeQuery.contextUsed,

        contextSource:
          knowledgeQuery.contextSource,
      },
    );

    knowledge =
      await knowledgeRetriever.search(
        knowledgeQuery.retrievalQuery,
      );

    console.log(
      "AI KNOWLEDGE RETRIEVAL",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        resultCount:
          knowledge.length,

        topScore:
          knowledge.length > 0

            ? Math.max(
                ...knowledge.map(
                  (
                    item,
                  ) =>
                    item.score,
                ),
              )

            : null,
      },
    );

  } catch (
    error:
      unknown
  ) {

    console.error(
      "Knowledge retrieval failed during inbound AI processing.",

      error instanceof Error
        ? error.message
        : error,
    );

    /*
     * Do not manufacture business information.
     */

    knowledge = [];
  }

  /*
   * --------------------------------------------------------
   * 11. Generate AI response
   * --------------------------------------------------------
   */

  const tenantAIInstructions =
    await loadTenantAIInstructions(
      db,
      profile.tenantId,
    );

  const reply =
    await generateAIReply(
      ai,
      history,
      message,
      profile,
      knowledge,
      tenantAIInstructions,
    );

  /*
   * --------------------------------------------------------
   * 12. Empty AI response
   * --------------------------------------------------------
   */

  if (
    !reply?.trim()
  ) {

    return;
  }

  const normalizedReply =
    reply.trim();

  /*
   * --------------------------------------------------------
   * 13. Natural AI response delay
   * --------------------------------------------------------
   */

  const deliveryDelay =
    calculateAIDeliveryDelay(
      normalizedReply,
    );

  console.log(
    "AI delivery delay",
    {
      tenantId:
        context.tenant.id,

      conversationId:
        message.conversationId,

      delayMs:
        deliveryDelay,

      responseLength:
        normalizedReply.length,
    },
  );

  await sleep(
    deliveryDelay,
  );

  /*
   * --------------------------------------------------------
   * Final stale-message guard
   * --------------------------------------------------------
   */

  console.log(
  "AI FINAL DELIVERY HISTORY CHECK START",
  {
    tenantId:
      context.tenant.id,

    conversationId:
      message.conversationId,

    messageId:
      message.providerMessageId,
  },
);

const latestBeforeSend =
  await messaging.getRecentMessages(
    context,
    message.conversationId,
    20,
  );

console.log(
  "AI FINAL DELIVERY HISTORY CHECK COMPLETE",
  {
    tenantId:
      context.tenant.id,

    conversationId:
      message.conversationId,

    messageId:
      message.providerMessageId,

    messageCount:
      latestBeforeSend.length,
  },
);

  const newerInboundMessageBeforeSend =
    hasNewerInboundMessage(
      latestBeforeSend,
      message.providerMessageId,
      message.occurredAt,
    );

  const humanTakeover =
    hasNewerHumanOutboundMessage(
      latestBeforeSend,
      message.providerMessageId,
      message.occurredAt,
    );

  if (
    humanTakeover
  ) {

    const latestHumanOutbound =
      findLatestHumanOutboundMessage(
        latestBeforeSend,
      );

    const existingSession =
      await sessionRepository.find(
        context.tenant.id,
        message.provider,
        message.conversationId,
      );

    await sessionRepository.upsert(
      context.tenant.id,
      message.provider,
      message.conversationId,
      "human_handoff",
      existingSession?.sessionStartedAt ??
        latestHumanOutbound?.timestamp ??
        message.occurredAt,
    );

    console.log(
      "AI RESPONSE SUPPRESSED DURING DELIVERY - HUMAN TAKEOVER",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        humanMessageId:
          latestHumanOutbound?.id ??
          null,

        humanMessageAt:
          latestHumanOutbound?.timestamp ??
          null,
      },
    );

    return;
  }

  if (
    newerInboundMessageBeforeSend
  ) {

    console.log(
      "AI response suppressed during delivery because a newer customer message arrived.",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,
      },
    );

    return;
  }

  /*
   * --------------------------------------------------------
   * 14. Send AI response
   * --------------------------------------------------------
   */

    console.log(
    "AI SEND START",
    {
      tenantId:
        context.tenant.id,

      conversationId:
        message.conversationId,

      messageId:
        message.providerMessageId,

      channel:
        message.channel,

      responseLength:
        normalizedReply.length,
    },
  );

  try {

    const sendResult =
      await messaging.sendText(
        context,
        {
          conversationId:
            message.conversationId,

          contactId:
            message.contactId,

          text:
            normalizedReply,

          channel:
            message.channel,

          channelProviderId:
            message.channelProviderId,
        },
      );

    console.log(
      "AI SEND SUCCESS",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        providerMessageId:
          sendResult.messageId,

        providerConversationId:
          sendResult.conversationId,
      },
    );

  } catch (
    error:
      unknown
  ) {

    console.error(
      "AI SEND FAILED",
      {
        tenantId:
          context.tenant.id,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        error:
          error instanceof Error
            ? error.message
            : error,
      },
    );

    throw error;
  }

  /*
   * --------------------------------------------------------
   * 15. Detect AI handoff offer
   * --------------------------------------------------------
   */

  if (
    isHandoffOffer(
      normalizedReply,
    )
  ) {

    const existingSession =
      await sessionRepository.find(
        context.tenant.id,
        message.provider,
        message.conversationId,
      );

    const sessionStartedAt =
      existingSession?.sessionStartedAt ??
      message.occurredAt;

    await sessionRepository.upsert(
      context.tenant.id,
      message.provider,
      message.conversationId,
      "handoff_pending",
      sessionStartedAt,
    );

    console.log(
      "AI handoff offer detected; conversation moved to handoff_pending.",
      {
        tenantId:
          context.tenant.id,

        provider:
          message.provider,

        conversationId:
          message.conversationId,

        messageId:
          message.providerMessageId,

        sessionStartedAt,

        reply:
          normalizedReply,
      },
    );
  }
}

catch (
  error:
    unknown
) {

  processingSucceeded =
    false;

  try {

    await eventService.markFailed(
      context.tenant.id,
      message.providerMessageId,
      error,
    );

  } catch (
    persistenceError:
      unknown
  ) {

    console.error(
      "Failed to persist GHL inbound processing failure state.",
      {
        tenantId:
          context.tenant.id,

        messageId:
          message.providerMessageId,

        error:
          persistenceError instanceof Error
            ? persistenceError.message
            : persistenceError,
      },
    );
  }

  console.error(
    "GHL inbound message processing failed after event claim.",
    {
      tenantId:
        context.tenant.id,

      provider:
        message.provider,

      conversationId:
        message.conversationId,

      messageId:
        message.providerMessageId,

      error:
        error instanceof Error
          ? error.message
          : error,
    },
  );

} finally {

  if (
    processingSucceeded
  ) {

    try {

      await eventService.markProcessed(
        context.tenant.id,
        message.providerMessageId,
      );

    } catch (
      error:
        unknown
    ) {

      console.error(
        "Failed to mark GHL inbound event as processed.",
        {
          tenantId:
            context.tenant.id,

          messageId:
            message.providerMessageId,

          error:
            error instanceof Error
              ? error.message
              : error,
        },
      );
    }
  }
}
}
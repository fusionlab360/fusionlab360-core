import {
  AIConversationSessionRepository,
} from "../../persistence/repositories/ai-conversation-session-repository";

import type {
  AIConversationSessionState,
} from "../../persistence/repositories/ai-conversation-session-repository";

import type {
  AIAgentProfile,
} from "../../persistence/models/ai-agent-profile";

import {
  isHumanHandoffRequest,
} from "../messaging/intent-guard";

/*
 * --------------------------------------------------
 * SESSION CONFIGURATION
 * --------------------------------------------------
 *
 * Production:
 *
 * - Active session continues while conversation activity
 *   remains inside the inactivity window.
 *
 * - After the inactivity window expires, the AI must NOT
 *   reply to the inbound message.
 *
 * - A new AI session is only created when there is no
 *   previous conversation activity.
 *
 * LIVE_SESSION_MODE is available for controlled testing.
 */

const LIVE_SESSION_MODE =
  false;

/*
 * --------------------------------------------------
 * Production session window
 * --------------------------------------------------
 *
 * 12 hours.
 */

const SESSION_WINDOW_MS =
  12 * 60 * 60 * 1000;

/*
 * --------------------------------------------------
 * Session choices
 * --------------------------------------------------
 */

export type AIChoice =
  | "continue"
  | "human"
  | "unknown";

export type HandoffConfirmation =
  | "confirm"
  | "decline"
  | "unknown";

/*
 * --------------------------------------------------
 * Session actions
 * --------------------------------------------------
 */

export type AISessionAction =
  | "prompt"
  | "ai"
  | "handoff"
  | "ignore";

export interface AISessionDecision {
  action:
    AISessionAction;

  state:
    AIConversationSessionState;

  response?:
    string;
}

/*
 * --------------------------------------------------
 * Template rendering
 * --------------------------------------------------
 */

function renderTemplate(
  template:
    string,

  profile:
    AIAgentProfile,
):
  string {

  return template
    .replace(
      /\{\{agentName\}\}/g,
      profile.agentName,
    )
    .replace(
      /\{\{businessName\}\}/g,
      profile.businessName,
    )
    .replace(
      /\{\{businessType\}\}/g,
      profile.businessType,
    );
}

/*
 * --------------------------------------------------
 * Determine whether a new session should begin
 * --------------------------------------------------
 *
 * This function is used when Core has no stored
 * session yet.
 *
 * A previous activity that is 12 hours old or older
 * does not qualify as an active session.
 */

function isNewSessionByInactivity(
  previousActivityAt:
    string |
    null,

  currentMessageAt:
    string,
):
  boolean {

  if (
    !previousActivityAt
  ) {
    return true;
  }

  const previous =
    new Date(
      previousActivityAt,
    ).getTime();

  const current =
    new Date(
      currentMessageAt,
    ).getTime();

  if (
    Number.isNaN(
      previous,
    ) ||
    Number.isNaN(
      current,
    )
  ) {
    return false;
  }

  return (
    current -
      previous <
    SESSION_WINDOW_MS
  );
}

/*
 * --------------------------------------------------
 * Normalize customer text
 * --------------------------------------------------
 *
 * Human-request detection itself is delegated to the
 * shared intent guard.
 */

function normalizeText(
  text:
    string,
):
  string {

  return text
    .trim()
    .toLowerCase()
    .replace(
      /[.,!?]/g,
      "",
    );
}

/*
 * --------------------------------------------------
 * Classify explicit customer choice
 * --------------------------------------------------
 *
 * Human detection is centralized in:
 *
 * ../messaging/intent-guard.ts
 *
 * This service therefore does not maintain a second
 * independent multilingual handoff system.
 */

function classifyChoice(
  text:
    string,
):
  AIChoice {

  const normalized =
    normalizeText(
      text,
    );

  /*
   * ------------------------------------------------
   * 1. Shared multilingual human detection
   * ------------------------------------------------
   */

  if (
    isHumanHandoffRequest(
      text,
    )
  ) {
    return "human";
  }

  /*
   * ------------------------------------------------
   * 2. Exact human choices
   * ------------------------------------------------
   */

  const exactHumanChoices = [
    "human",
    "staff",
    "team",
    "agent",
    "person",
    "someone",
    "support",
    "representative",
    "manager",
    "supervisor",
    "real person",

    "human please",
    "staff please",
    "support please",
    "someone please",

    "talk to human",
    "speak to human",

    "talk to a human",
    "speak to a human",

    "talk to person",
    "speak to person",

    "talk to a person",
    "speak to a person",

    "talk to staff",
    "speak to staff",

    "talk to someone",
    "speak to someone",

    "talk to the team",
    "speak to the team",

    "talk to manager",
    "speak to manager",

    "talk to a manager",
    "speak to a manager",
  ];

  if (
    exactHumanChoices.includes(
      normalized,
    )
  ) {
    return "human";
  }

  /*
   * ------------------------------------------------
   * 3. Additional explicit English handoff phrases
   * ------------------------------------------------
   */

  const extendedHumanPatterns = [
    /\bconnect me to (a )?human\b/,
    /\bconnect me to (a )?person\b/,
    /\bconnect me to (the )?team\b/,

    /\bput me through to (a )?human\b/,
    /\bput me through to (a )?person\b/,

    /\blet me speak to (a )?human\b/,
    /\blet me speak to (a )?person\b/,

    /\bi want to speak to (a )?human\b/,
    /\bi want to speak to (a )?person\b/,

    /\bi want to talk to (a )?human\b/,
    /\bi want to talk to (a )?person\b/,

    /\bi need to speak to (a )?human\b/,
    /\bi need to speak to (a )?person\b/,

    /\bi need a human\b/,
    /\bi need a real person\b/,

    /\bcan i speak to (a )?human\b/,
    /\bcan i speak to (a )?person\b/,

    /\bcan i talk to (a )?human\b/,
    /\bcan i talk to (a )?person\b/,

    /\bnot (the )?ai\b/,

    /\bdont want (the )?ai\b/,
    /\bdon't want (the )?ai\b/,

    /\bstop (the )?ai\b/,
    /\bstop responding\b/,

    /\bno more ai\b/,
  ];

  if (
    extendedHumanPatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  ) {
    return "human";
  }

  /*
   * ------------------------------------------------
   * 4. Customer choosing AI
   * ------------------------------------------------
   */

  const continuePatterns = [
    /^yes$/,
    /^yeah$/,
    /^yep$/,
    /^sure$/,
    /^ok$/,
    /^okay$/,
    /^continue$/,
    /^go ahead$/,
    /^proceed$/,
    /^continue with (you|ai)$/,
    /^continue chatting$/,
    /^continue chat$/,
    /^chat with you$/,
    /^chat with ai$/,
    /^yes continue$/,
    /^yes please$/,
  ];

  if (
    continuePatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  ) {
    return "continue";
  }

  return "unknown";
}

/*
 * --------------------------------------------------
 * Classify response to an existing handoff offer
 * --------------------------------------------------
 *
 * Important:
 *
 * "Yes" has different meanings depending on state.
 *
 * awaiting_choice + "yes"
 *     → continue with AI
 *
 * handoff_pending + "yes"
 *     → accept human handoff
 */

function classifyHandoffConfirmation(
  text:
    string,
):
  HandoffConfirmation {

  const normalized =
    normalizeText(
      text,
    );

  /*
   * ------------------------------------------------
   * Confirm handoff
   * ------------------------------------------------
   */

  const confirmPatterns = [
    /^yes$/,
    /^yeah$/,
    /^yep$/,
    /^sure$/,
    /^ok$/,
    /^okay$/,

    /^yes please$/,
    /^sure please$/,

    /^go ahead$/,
    /^please do$/,
    /^do it$/,
    /^please$/,

    /^connect me$/,
    /^put me through$/,

    /^talk to someone$/,
    /^speak to someone$/,

    /^talk to the team$/,
    /^speak to the team$/,

    /^yes connect me$/,
    /^yes put me through$/,

    /^yes talk to someone$/,
    /^yes speak to someone$/,
  ];

  if (
    confirmPatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  ) {
    return "confirm";
  }

  /*
   * ------------------------------------------------
   * Decline handoff
   * ------------------------------------------------
   */

  const declinePatterns = [
    /^no$/,
    /^no thanks$/,
    /^no thank you$/,

    /^not now$/,

    /^never mind$/,
    /^nevermind$/,

    /^forget it$/,
    /^leave it$/,

    /^i'll continue$/,
    /^ill continue$/,

    /^continue with ai$/,

    /^continue chatting$/,

    /^i'll continue chatting$/,
    /^ill continue chatting$/,
  ];

  if (
    declinePatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  ) {
    return "decline";
  }

  return "unknown";
}

/*
 * --------------------------------------------------
 * AI Session Service
 * --------------------------------------------------
 */

export class AISessionService {

  constructor(
    private readonly repository:
      AIConversationSessionRepository,
  ) {}

  async handleInbound(
    input: {
      tenantId:
        string;

      provider:
        string;

      conversationId:
        string;

      messageText:
        string;

      occurredAt:
        string;

      previousActivityAt:
        string |
        null;

      profile:
        AIAgentProfile;
    },
  ):
    Promise<
      AISessionDecision
    > {

    /*
     * ------------------------------------------------
     * 1. Load existing session
     * ------------------------------------------------
     */

    const existing =
      await this.repository.find(
        input.tenantId,
        input.provider,
        input.conversationId,
      );

    /*
     * ------------------------------------------------
     * 2. Determine current session activity
     * ------------------------------------------------
     *
     * Existing Core session activity takes priority.
     *
     * If no Core session exists, use the provider's
     * previous conversation activity.
     */

    const sessionActivityAt =
      existing?.updatedAt ??
      input.previousActivityAt;

    /*
     * ------------------------------------------------
     * 3. Enforce 12-hour AI inactivity window
     * ------------------------------------------------
     *
     * Important:
     *
     * An ignored / expired message must NOT update the
     * session timestamp.
     */

    if (
      sessionActivityAt
    ) {

      const sessionActivityTime =
        new Date(
          sessionActivityAt,
        ).getTime();

      const currentMessageTime =
        new Date(
          input.occurredAt,
        ).getTime();

      /*
       * Invalid timestamp:
       *
       * Fail closed.
       */

      if (
        Number.isNaN(
          sessionActivityTime,
        ) ||
        Number.isNaN(
          currentMessageTime,
        )
      ) {

        console.log(
          "AI INACTIVE - unable to validate conversation activity timestamp",
          {
            tenantId:
              input.tenantId,

            provider:
              input.provider,

            conversationId:
              input.conversationId,

            sessionActivityAt,
          },
        );

        return {
          action:
            "ignore",

          state:
            existing?.state ??
            "human_handoff",
        };
      }

      const inactivityMs =
        currentMessageTime -
        sessionActivityTime;

      /*
       * 12-hour inactivity has expired.
       */

      if (
        inactivityMs >=
        SESSION_WINDOW_MS
      ) {

        console.log(
          "AI INACTIVE - conversation exceeded 12-hour inactivity window",
          {
            tenantId:
              input.tenantId,

            provider:
              input.provider,

            conversationId:
              input.conversationId,

            sessionActivityAt,

            currentMessageAt:
              input.occurredAt,

            inactivityHours:
              inactivityMs /
              (60 * 60 * 1000),

            existingState:
              existing?.state ??
              null,
          },
        );

        return {
          action:
            "ignore",

          state:
            existing?.state ??
            "human_handoff",
        };
      }
    }

    /*
     * ------------------------------------------------
     * 4. Determine new session
     * ------------------------------------------------
     */

    const newSession =
      existing
        ? false
        : (
            !input.previousActivityAt ||
            isNewSessionByInactivity(
              input.previousActivityAt,
              input.occurredAt,
            )
          );

    /*
     * ------------------------------------------------
     * 5. Existing HANDOFF_PENDING
     * ------------------------------------------------
     *
     * This block MUST run before the generic choice
     * handling below.
     *
     * Explicit handoff choices are handled first.
     *
     * Otherwise, the customer's message is allowed
     * back into the AI pipeline.
     *
     * The state remains handoff_pending.
     */

    if (
      existing &&
      !newSession &&
      existing.state ===
        "handoff_pending"
    ) {

      /*
       * ----------------------------------------------
       * Direct human request always wins.
       * ----------------------------------------------
       */

      const explicitChoice =
        classifyChoice(
          input.messageText,
        );

      if (
        explicitChoice ===
        "human"
      ) {

        await this.repository.upsert(
          input.tenantId,
          input.provider,
          input.conversationId,
          "human_handoff",
          existing.sessionStartedAt,
        );

        return {
          action:
            "handoff",

          state:
            "human_handoff",

          response:
            renderTemplate(
              input.profile.handoffTemplate,
              input.profile,
            ),
        };
      }

      /*
       * ----------------------------------------------
       * Customer accepts the pending handoff.
       * ----------------------------------------------
       */

      const confirmation =
        classifyHandoffConfirmation(
          input.messageText,
        );

      if (
        confirmation ===
        "confirm"
      ) {

        await this.repository.upsert(
          input.tenantId,
          input.provider,
          input.conversationId,
          "human_handoff",
          existing.sessionStartedAt,
        );

        return {
          action:
            "handoff",

          state:
            "human_handoff",

          response:
            renderTemplate(
              input.profile.handoffTemplate,
              input.profile,
            ),
        };
      }

      /*
       * ----------------------------------------------
       * Customer declines the handoff.
       * ----------------------------------------------
       */

      if (
        confirmation ===
        "decline"
      ) {

        await this.repository.upsert(
          input.tenantId,
          input.provider,
          input.conversationId,
          "ai_active",
          existing.sessionStartedAt,
        );

        return {
          action:
            "ai",

          state:
            "ai_active",
        };
      }

      /*
       * ----------------------------------------------
       * NATURAL CONVERSATION WHILE HANDOFF IS PENDING
       * ----------------------------------------------
       *
       * The customer has not accepted or declined
       * the handoff.
       *
       * Do NOT silence the conversation.
       *
       * Allow the message through the normal AI
       * pipeline.
       *
       * The AI / Knowledge layer will decide whether
       * the message is:
       *
       * - ordinary conversation
       * - business knowledge
       * - medical
       * - booking
       * - another controlled request
       *
       * The pending handoff is NOT cancelled.
       */

      console.log(
        "AI HANDOFF PENDING - customer message allowed into AI pipeline",
        {
          tenantId:
            input.tenantId,

          provider:
            input.provider,

          conversationId:
            input.conversationId,

          currentState:
            existing.state,
        },
      );

      return {
        action:
          "ai",

        state:
          "handoff_pending",
      };
    }

    /*
     * ------------------------------------------------
     * 6. Explicit human request
     * ------------------------------------------------
     *
     * Applies to:
     *
     * - new sessions
     * - ai_active
     * - awaiting_choice
     *
     * Human detection is handled by the shared guard.
     */

    const choice =
      classifyChoice(
        input.messageText,
      );

    if (
      choice ===
      "human"
    ) {

      await this.repository.upsert(
        input.tenantId,
        input.provider,
        input.conversationId,
        "human_handoff",
        input.occurredAt,
      );

      return {
        action:
          "handoff",

        state:
          "human_handoff",

        response:
          renderTemplate(
            input.profile.handoffTemplate,
            input.profile,
          ),
      };
    }

    /*
     * ------------------------------------------------
     * 7. NEW SESSION
     * ------------------------------------------------
     *
     * The actual customer message is handled by the
     * normal AI pipeline.
     *
     * No automatic greeting is generated here.
     */

    if (
      newSession
    ) {

      await this.repository.upsert(
        input.tenantId,
        input.provider,
        input.conversationId,
        "ai_active",
        input.occurredAt,
      );

      return {
        action:
          "ai",

        state:
          "ai_active",
      };
    }

    /*
     * ------------------------------------------------
     * 8. Existing conversation without Core session
     * ------------------------------------------------
     *
     * Do not silently take over a recent provider
     * conversation that Core does not own.
     */

    if (
      !existing
    ) {

      await this.repository.upsert(
        input.tenantId,
        input.provider,
        input.conversationId,
        "human_handoff",
        input.occurredAt,
      );

      return {
        action:
          "ignore",

        state:
          "human_handoff",
      };
    }

    /*
     * ------------------------------------------------
     * 9. Existing session
     * ------------------------------------------------
     */

    switch (
      existing.state
    ) {

      /*
       * ----------------------------------------------
       * HUMAN_HANDOFF
       * ----------------------------------------------
       *
       * Human has control.
       *
       * AI remains silent.
       */

      case "human_handoff":

        return {
          action:
            "ignore",

          state:
            "human_handoff",
        };

      /*
       * ----------------------------------------------
       * AI_ACTIVE
       * ----------------------------------------------
       *
       * Refresh the activity timestamp because this
       * message is part of the active AI conversation.
       */

      case "ai_active":

        await this.repository.upsert(
          input.tenantId,
          input.provider,
          input.conversationId,
          "ai_active",
          existing.sessionStartedAt,
        );

        return {
          action:
            "ai",

          state:
            "ai_active",
        };

      /*
       * ----------------------------------------------
       * AWAITING_CHOICE
       * ----------------------------------------------
       *
       * Legacy state.
       *
       * Explicit human requests were already handled
       * above.
       *
       * Any other message continues with AI.
       */

      case "awaiting_choice": {

        await this.repository.upsert(
          input.tenantId,
          input.provider,
          input.conversationId,
          "ai_active",
          existing.sessionStartedAt,
        );

        return {
          action:
            "ai",

          state:
            "ai_active",
        };
      }

      /*
       * ----------------------------------------------
       * HANDOFF_PENDING
       * ----------------------------------------------
       *
       * Normally intercepted above.
       *
       * Defensive fallback.
       */

      case "handoff_pending":

        return {
          action:
            "ignore",

          state:
            "handoff_pending",
        };
    }

    /*
     * ------------------------------------------------
     * 10. Defensive fallback
     * ------------------------------------------------
     */

        return {
      action:
        "ignore",

      state:
        existing.state,
    };
  }

  /*
   * --------------------------------------------------
   * Human takeover
   * --------------------------------------------------
   *
   * Called when a real human agent sends a message
   * while an AI response may still be in flight.
   *
   * This immediately changes the conversation to
   * human_handoff so all later AI checks fail closed.
   */
  async markHumanTakeover(
    tenantId:
      string,

    provider:
      string,

    conversationId:
      string,

    occurredAt:
      string,
  ):
    Promise<void> {

    const existing =
      await this.repository.find(
        tenantId,
        provider,
        conversationId,
      );

    await this.repository.upsert(
      tenantId,
      provider,
      conversationId,
      "human_handoff",
      existing?.sessionStartedAt ??
        occurredAt,
    );

    console.log(
      "AI SESSION STOPPED BY HUMAN TAKEOVER",
      {
        tenantId,
        provider,
        conversationId,
        occurredAt,
        previousState:
          existing?.state ??
          null,
      },
    );
  }
}
/*
 * --------------------------------------------------
 * Knowledge Query Context Resolution
 * --------------------------------------------------
 *
 * Provider-neutral conversation context handling.
 *
 * Purpose:
 *
 * Convert genuinely short / incomplete / follow-up
 * customer questions into a retrieval query that
 * preserves the previous meaningful customer topic.
 *
 * Important:
 *
 * A short query is NOT automatically a follow-up.
 *
 * For example:
 *
 *   "What is the Alam Impian mobile number?"
 *
 * is short enough to contain only a few meaningful
 * terms, but it is already a complete business question.
 *
 * It MUST remain standalone.
 *
 * This module NEVER uses previous AI answers as
 * factual evidence.
 *
 * Only previous meaningful customer messages are used
 * to build retrieval context.
 *
 * Pure conversational acknowledgements and greetings
 * are deliberately excluded from retrieval context.
 *
 * --------------------------------------------------
 */

export interface KnowledgeQueryHistoryItem {
  role:
    | "customer"
    | "ai"
    | "human";

  text:
    string;

  timestamp?:
    string |
    null;
}

export interface KnowledgeQueryResolution {
  originalQuery:
    string;

  retrievalQuery:
    string;

  contextUsed:
    boolean;

  contextSource:
    string |
    null;
}

/* ==================================================
 * Configuration
 * ================================================== */

const MAX_CONTEXT_CHARS =
  500;

const MAX_COMBINED_QUERY_CHARS =
  1200;

const MAX_CONTEXT_MESSAGES =
  3;

const CONTEXT_WINDOW_MS =
  12 * 60 * 60 * 1000;

/*
 * A short message can still be a complete question.
 *
 * This threshold is therefore used only after checking
 * whether the message already looks self-contained.
 */
const MAX_FRAGMENT_TERMS =
  4;

/* ==================================================
 * Normalization
 * ================================================== */

function normalize(
  value:
    string,
):
  string {

  return value
    .normalize(
      "NFKC",
    )
    .toLowerCase()
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

/* ==================================================
 * Meaningful terms
 * ================================================== */

function extractMeaningfulTerms(
  value:
    string,
):
  string[] {

  const normalized =
    normalize(
      value,
    );

  if (
    !normalized
  ) {
    return [];
  }

  return normalized
    .split(
      /\s+/u,
    )
    .filter(
      (
        token,
      ) =>
        token.length >=
          3 &&
        !/^(the|and|for|with|that|this|what|when|where|which|how|does|do|is|are|can|could|would|should|will|it|its|i|me|my|you|your|we|our|to|of|in|on|at|a|an)$/u.test(
          token,
        ),
    );
}

/* ==================================================
 * Pure conversational messages
 * ==================================================
 *
 * These messages should not become retrieval context.
 *
 * Examples:
 *
 * Hi
 * Hello
 * Thanks
 * Thank you
 * Okay
 * Sure
 * Got it
 * Great
 * Yes
 * No
 * Bye
 *
 * Exact matching is intentional.
 *
 * Therefore:
 *
 * "Okay, what are your opening hours?"
 *
 * is NOT treated as a pure acknowledgement.
 * ==================================================
 */

function isPureConversation(
  text:
    string,
):
  boolean {

  const normalized =
    normalize(
      text,
    );

  if (
    !normalized
  ) {
    return true;
  }

  const pureConversationPatterns = [
    /^hi!?$/i,
    /^hello!?$/i,
    /^hey!?$/i,
    /^hai!?$/i,
    /^helo!?$/i,

    /^hi\s+there!?$/i,
    /^hello\s+there!?$/i,
    /^hey\s+there!?$/i,

    /^thanks!?$/i,
    /^thank\s+you!?$/i,
    /^thx!?$/i,
    /^thank\s+you\s+so\s+much!?$/i,
    /^thanks\s+so\s+much!?$/i,

    /^ok!?$/i,
    /^okay!?$/i,
    /^alright!?$/i,
    /^all\s+right!?$/i,

    /^sure!?$/i,
    /^yes!?$/i,
    /^yeah!?$/i,
    /^yep!?$/i,
    /^ya!?$/i,

    /^no!?$/i,
    /^nope!?$/i,

    /^got\s+it!?$/i,
    /^understood!?$/i,
    /^i\s+understand!?$/i,

    /^great!?$/i,
    /^perfect!?$/i,
    /^nice!?$/i,
    /^good!?$/i,
    /^sounds\s+good!?$/i,
    /^that'?s\s+good!?$/i,

    /^bye!?$/i,
    /^goodbye!?$/i,
    /^see\s+you!?$/i,

    /^thank[s]?\s+again!?$/i,
  ];

  return pureConversationPatterns.some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

/* ==================================================
 * Explicit follow-up patterns
 * ==================================================
 *
 * These expressions indicate that the current
 * message depends on an already established topic.
 *
 * Examples:
 *
 * "What about that?"
 * "How about it?"
 * "Can I book it?"
 * "Does it include breakfast?"
 * "What about the other one?"
 * "Can you repeat that?"
 * ==================================================
 */

function isFollowUpPattern(
  text:
    string,
):
  boolean {

  const normalized =
    normalize(
      text,
    );

  return [
    /\bwhat\s+about\b/i,

    /\bhow\s+about\b/i,

    /\band\s+what\b/i,

    /\band\s+how\b/i,

    /\bwhat\s+about\s+it\b/i,

    /\bhow\s+much\s+is\s+it\b/i,

    /\bhow\s+long\s+is\s+it\b/i,

    /\bwhen\s+is\s+it\b/i,

    /\bwhat\s+time\s+is\s+it\b/i,

    /\bis\s+it\s+available\b/i,

    /\bdoes\s+it\b/i,

    /\bcan\s+i\s+book\s+it\b/i,

    /\bcan\s+i\s+get\s+it\b/i,

    /\bcan\s+we\s+book\s+it\b/i,

    /\bwhat\s+about\s+that\b/i,

    /\bwhat\s+about\s+this\b/i,

    /\bhow\s+about\s+that\b/i,

    /\bhow\s+about\s+this\b/i,

    /\bthe\s+same\b/i,

    /\bthat\b/i,

    /\bthis\b/i,

    /\bit\b/i,
  ].some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

/* ==================================================
 * Incomplete question / conversational fragment
 * ==================================================
 *
 * These are deliberately limited.
 *
 * Examples:
 *
 * "How much?"
 * "What time?"
 * "Which one?"
 * "Where?"
 * "Can I?"
 * "Mobile number?"
 * "Address?"
 *
 * A complete question such as:
 *
 * "What is the Alam Impian mobile number?"
 *
 * MUST NOT match this function.
 * ==================================================
 */

function isEllipticalFollowUp(
  text:
    string,
):
  boolean {

  const normalized =
    normalize(
      text,
    );

  return [
    /^how\s+much\??$/i,

    /^how\s+long\??$/i,

    /^what\s+time\??$/i,

    /^when\??$/i,

    /^where\??$/i,

    /^which\s+one\??$/i,

    /^which\??$/i,

    /^who\??$/i,

    /^how\??$/i,

    /^can\s+i\??$/i,

    /^can\s+we\??$/i,

    /^mobile\s+number\??$/i,

    /^phone\s+number\??$/i,

    /^contact\s+number\??$/i,

    /^number\??$/i,

    /^address\??$/i,

    /^location\??$/i,

    /^whatsapp\??$/i,

    /^the\s+number\??$/i,

    /^the\s+address\??$/i,

    /^the\s+same\??$/i,

    /^same\??$/i,

    /^the\s+other\s+one\??$/i,

    /^the\s+other\??$/i,

    /^and\??$/i,
  ].some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

/* ==================================================
 * Complete question detection
 * ==================================================
 *
 * This is the important protection against accidental
 * context contamination.
 *
 * A message that is already a self-contained question
 * should remain standalone, even if it contains only
 * 1-4 meaningful terms.
 *
 * Examples:
 *
 * "What is the Alam Impian mobile number?"
 * "What services do you provide?"
 * "Where is Kota Kemuning?"
 * "What time does breakfast start?"
 * "Can I book an appointment?"
 *
 * These should NOT inherit the previous topic.
 * ==================================================
 */

function isCompleteQuestion(
  text:
    string,
):
  boolean {

  const normalized =
    normalize(
      text,
    );

  if (
    !normalized
  ) {
    return false;
  }

  /*
   * Explicit question mark.
   *
   * Even a short question such as:
   *
   * "Where is Alam Impian?"
   *
   * is normally self-contained unless it also contains
   * a clear backward reference such as "it", "that",
   * "this", "the same", etc.
   */
  if (
    /\?$/u.test(
      normalized,
    )
  ) {

    if (
      isFollowUpPattern(
        normalized,
      )
    ) {
      /*
       * A question mark alone does not override an
       * explicit backward-reference pattern.
       */
      return false;
    }

    if (
      isEllipticalFollowUp(
        normalized,
      )
    ) {
      return false;
    }

    return true;
  }

  /*
   * Complete interrogative structures even when the
   * customer omits the question mark.
   *
   * This is common in WhatsApp/live chat.
   */
  const completeQuestionPatterns = [
    /^(what|which|where|when|who|why|how)\b/i,

    /^can\s+(i|we|you)\b/i,

    /^could\s+(i|we|you)\b/i,

    /^would\s+(it|you)\b/i,

    /^do\s+(you|we)\b/i,

    /^does\s+(it|the|this|that|your|the\s+branch|the\s+clinic)\b/i,

    /^did\s+(you|we)\b/i,

    /^is\s+(it|the|this|that|there)\b/i,

    /^are\s+(you|we|there|the)\b/i,

    /^will\s+(you|we|it)\b/i,

    /^may\s+(i|we)\b/i,

    /^please\s+(tell|give|send|share)\b/i,

    /\b(tell\s+me|give\s+me|send\s+me|show\s+me)\b/i,

    /^(berapa|apa|siapa|bila|di\s+mana|boleh|adakah)\b/i,

    /\b(nak\s+tahu|boleh\s+saya\s+tahu)\b/i,

    /^(什么|哪里|什么时候|多少|谁|有没有|可以|请问)/u,

    /(告诉我|我想知道|可以吗)/u,
  ];

  return completeQuestionPatterns.some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

/* ==================================================
 * Short fragment detection
 * ==================================================
 *
 * IMPORTANT:
 *
 * Shortness is now a fallback signal only.
 *
 * We first protect complete/self-contained questions.
 *
 * Therefore:
 *
 * "What is the Alam Impian mobile number?"
 *
 * -> complete question
 * -> NOT a fragment
 * -> no context
 *
 * while:
 *
 * "Mobile number?"
 *
 * -> elliptical fragment
 * -> context may be used
 *
 * This eliminates the previous "4 meaningful terms"
 * contamination bug.
 * ==================================================
 */

function isShortFragment(
  text:
    string,
):
  boolean {

  const normalized =
    normalize(
      text,
    );

  if (
    !normalized
  ) {
    return false;
  }

  /*
   * A complete question is never treated as a short
   * fragment merely because it has few terms.
   */
  if (
    isCompleteQuestion(
      normalized,
    )
  ) {
    return false;
  }

  /*
   * Explicit elliptical questions are context
   * candidates regardless of term count.
   */
  if (
    isEllipticalFollowUp(
      normalized,
    )
  ) {
    return true;
  }

  const terms =
    extractMeaningfulTerms(
      normalized,
    );

  /*
   * Very short non-question fragments can depend
   * strongly on the previous customer topic.
   *
   * Examples:
   *
   * "Alam Impian"
   * "Mobile number"
   * "The address"
   */
  return (
    terms.length <=
    MAX_FRAGMENT_TERMS
  );
}

/* ==================================================
 * Context-dependent query detection
 * ==================================================
 *
 * Order matters:
 *
 * 1. Pure conversation → NEVER context.
 * 2. Complete standalone question → NEVER implicit
 *    context.
 * 3. Explicit follow-up → context.
 * 4. Elliptical/short fragment → context.
 *
 * This gives explicit conversational references
 * priority over generic shortness.
 * ==================================================
 */

function isContextDependentQuery(
  text:
    string,
):
  boolean {

  if (
    isPureConversation(
      text,
    )
  ) {
    return false;
  }

  /*
   * A complete self-contained question should stay
   * standalone unless it explicitly refers backward.
   */
  if (
    isCompleteQuestion(
      text,
    )
  ) {

    return isFollowUpPattern(
      text,
    );
  }

  if (
    isFollowUpPattern(
      text,
    )
  ) {
    return true;
  }

  return isShortFragment(
    text,
  );
}

/* ==================================================
 * Clean customer message
 * ================================================== */

function cleanCustomerMessage(
  text:
    string,
):
  string {

  return text
    .trim()
    .replace(
      /\s+/g,
      " ",
    )
    .slice(
      0,
      MAX_CONTEXT_CHARS,
    );
}

function selectRecentCustomerContext(
  messages:
    string[],
):
  string[] {

  return messages
    .slice(
      Math.max(
        0,
        messages.length -
          MAX_CONTEXT_MESSAGES,
      ),
    )
    .filter(
      (
        message,
      ) =>
        message.length >
        0,
    );
}

function selectTopicRelevantContext(
  currentQuery:
    string,

  contextMessages:
    string[],
):
  string[] {

  const currentTerms =
    extractMeaningfulTerms(
      currentQuery,
    );

  /*
   * Explicit/elliptical follow-ups may have no
   * meaningful topic terms ("what about it?",
   * "what time?"). In that case, preserve recent
   * customer context.
   */
  const currentHasSpecificTerms =
    currentTerms.length >
    0;

  if (
    !currentHasSpecificTerms
  ) {

    return contextMessages;
  }

  /*
   * Prefer previous customer messages that share
   * meaningful terms with the current question.
   */
  const scored =
    contextMessages.map(
      (
        message,
        index,
      ) => {

        const messageTerms =
          extractMeaningfulTerms(
            message,
          );

        const overlap =
          currentTerms.filter(
            (
              term,
            ) =>
              messageTerms.includes(
                term,
              ),
          ).length;

        return {
          message,
          index,
          overlap,
        };
      },
    );

  const relevant =
    scored.filter(
      (
        item,
      ) =>
        item.overlap >
        0,
    );

  /*
   * No topical overlap means the customer most
   * likely changed subject. Do not drag the old
   * topic into retrieval.
   */
  if (
    relevant.length ===
    0
  ) {

    return [];
  }

  return relevant
    .sort(
      (
        a,
        b,
      ) =>
        b.overlap -
        a.overlap ||
        b.index -
        a.index,
    )
    .slice(
      0,
      MAX_CONTEXT_MESSAGES,
    )
    .sort(
      (
        a,
        b,
      ) =>
        a.index -
        b.index,
    )
    .map(
      (
        item,
      ) =>
        item.message,
    );
}

function selectTopicAnchor(
  messages:
    string[],
):
  string | null {

  for (
    let index =
      messages.length - 1;

    index >= 0;

    index--
  ) {

    const message =
      messages[index];

    if (
      isPureConversation(
        message,
      )
    ) {

      continue;
    }

    if (
      isEllipticalFollowUp(
        message,
      )
    ) {

      continue;
    }

    if (
      isCompleteQuestion(
        message,
      )
    ) {

      return message;
    }

    const terms =
      extractMeaningfulTerms(
        message,
      );

    if (
      terms.length > 0
    ) {

      return message;
    }
  }

  return null;
}

/* ==================================================
 * Resolve knowledge query
 * ================================================== */

export function resolveKnowledgeQuery(
  currentQuery:
    string,

  history:
    KnowledgeQueryHistoryItem[],

  currentQueryAt:
    string,
):

  KnowledgeQueryResolution {

  const originalQuery =
    currentQuery.trim();

  if (
    !originalQuery
  ) {

    return {
      originalQuery,

      retrievalQuery:
        originalQuery,

      contextUsed:
        false,

      contextSource:
        null,
    };
  }

  /*
   * Only use context for short or conversationally
   * dependent customer messages.
   */
  if (
    !isContextDependentQuery(
      originalQuery,
    )
  ) {

    return {
      originalQuery,

      retrievalQuery:
        originalQuery,

      contextUsed:
        false,

      contextSource:
        null,
    };
  }

  /*
   * Only previous customer messages are allowed
   * to influence retrieval context.
   *
   * AI and human messages are deliberately excluded.
   */
  const currentTime =
  new Date(
    currentQueryAt,
  ).getTime();

if (
  !Number.isFinite(
    currentTime,
  )
) {

  return {
    originalQuery,

    retrievalQuery:
      originalQuery,

    contextUsed:
      false,

    contextSource:
      null,
  };
}

const previousCustomerMessages =
  history
    .filter(
      (
        item,
      ) => {

        if (
          item.role !==
            "customer" ||
          !item.text.trim()
        ) {

          return false;
        }

        if (
          !item.timestamp
        ) {

          return false;
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

          return false;
        }

        const age =
          currentTime -
          itemTime;

        return (
          age >= 0 &&
          age <
            CONTEXT_WINDOW_MS
        );
      },
    )
    .map(
      (
        item,
      ) =>
        cleanCustomerMessage(
          item.text,
        ),
    )
    .filter(
      (
        text,
      ) =>
        text.length >
        0,
    );

  if (
    previousCustomerMessages.length ===
    0
  ) {

    return {
      originalQuery,

      retrievalQuery:
        originalQuery,

      contextUsed:
        false,

      contextSource:
        null,
    };
  }

  /*
   * Use only the most recent three customer
   * messages as conversational context.
   */
  const contextMessages =
    previousCustomerMessages.slice(
      -3,
    );

  /*
   * Prevent duplicate current/previous messages
   * from being added to the retrieval query.
   */
  const deduplicatedContextMessages =
  contextMessages.filter(
    (
      message,
    ) =>
      normalize(
        message,
      ) !==
      normalize(
        originalQuery,
      ),
  );

const filteredContextMessages =
  selectTopicRelevantContext(
    originalQuery,
    deduplicatedContextMessages,
  );

const topicAnchor =
  selectTopicAnchor(
    deduplicatedContextMessages,
  );

  if (
    filteredContextMessages.length ===
    0
  ) {

    return {
      originalQuery,

      retrievalQuery:
        originalQuery,

      contextUsed:
        false,

      contextSource:
        null,
    };
  }

  /*
   * Combine recent customer context with the
   * current question for retrieval.
   */
  const retrievalParts =
  [
    topicAnchor,
    ...filteredContextMessages,
    originalQuery,
  ].filter(
    (
      value,
    ): value is string =>
      Boolean(
        value,
      ),
  );

const uniqueRetrievalParts =
  [
    ...new Map(
      retrievalParts.map(
        (
          value,
        ) => [
          normalize(
            value,
          ),
          value,
        ],
      ),
    ).values(),
  ];

const retrievalQuery =
  uniqueRetrievalParts
    .join(
      " ",
    )
    .slice(
      0,
      MAX_COMBINED_QUERY_CHARS,
    );

  return {
    originalQuery,

    retrievalQuery,

    contextUsed:
      true,

    contextSource:
      filteredContextMessages.join(
        " | ",
      ),
  };
}
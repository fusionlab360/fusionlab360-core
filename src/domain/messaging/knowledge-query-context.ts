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
 * Follow-up attribute terms
 * ==================================================
 *
 * These terms describe information being requested,
 * rather than a new business entity/topic.
 *
 * They are provider-neutral and industry-neutral.
 *
 * Example:
 *
 * "What about the price?"
 *
 * price = requested attribute
 *
 * "What about the Rimbayu branch?"
 *
 * Rimbayu = new topic/entity
 * branch  = entity qualifier
 * ==================================================
 */

const FOLLOW_UP_ATTRIBUTE_TERMS =
  new Set<string>([
    "price",
    "prices",
    "cost",
    "costs",
    "fee",
    "fees",
    "charge",
    "charges",
    "rate",
    "rates",
    "pricing",

    "time",
    "times",
    "hour",
    "hours",
    "open",
    "opens",
    "close",
    "closes",
    "opening",
    "closing",
    "operating",

    "address",
    "location",
    "locations",

    "phone",
    "mobile",
    "telephone",
    "number",
    "contact",
    "whatsapp",
    "email",

    "availability",
    "available",
    "slot",
    "slots",

    "booking",
    "book",
    "reservation",
    "appointment",

    "service",
    "services",
    "facility",
    "facilities",
    "amenity",
    "amenities",

    "doctor",
    "doctors",
    "staff",
    "specialist",
    "specialists",

    "package",
    "packages",

    "discount",
    "discounts",
    "promotion",
    "promotions",
    "promo",

    "policy",
    "policies",

    "details",
    "information",
  ]);

  /*
 * ==================================================
 * Implicit entity-dependent follow-up attributes
 * ==================================================
 *
 * These attributes commonly refer back to an already
 * established business entity/topic even when the
 * customer does not use words such as "it", "that",
 * or "what about".
 *
 * Example:
 *
 * "Where is Alam Impian?"
 * "What time do you open?"
 *
 * The second message is complete grammatically, but
 * "time/open" can still refer to the previously
 * established entity.
 *
 * Keep this list conservative. Global business
 * questions such as contact details and general
 * service lists are deliberately excluded.
 * ==================================================
 */

const IMPLICIT_FOLLOW_UP_ATTRIBUTE_TERMS =
  new Set<string>([
    "price",
    "prices",
    "cost",
    "costs",
    "fee",
    "fees",
    "charge",
    "charges",
    "rate",
    "rates",
    "pricing",

    "time",
    "times",
    "hour",
    "hours",
    "open",
    "opens",
    "close",
    "closes",
    "opening",
    "closing",
    "operating",

    "availability",
    "available",
    "slot",
    "slots",
    "vacancy",

    "booking",
    "book",
    "reservation",
    "reservations",
    "appointment",
    "appointments",
  ]);


/*
 * Words that refer back to the established topic.
 */

const FOLLOW_UP_REFERENCE_TERMS =
  new Set<string>([
    "it",
    "this",
    "that",
    "these",
    "those",
    "same",
    "other",
    "one",
  ]);


function extractTopicSubjectTerms(
  value:
    string,
):
  string[] {

  return extractMeaningfulTerms(
    value,
  ).filter(
    (
      term,
    ) =>
      !FOLLOW_UP_ATTRIBUTE_TERMS.has(
        term,
      ) &&
      !FOLLOW_UP_REFERENCE_TERMS.has(
        term,
      ),
  );
}

function hasNewTopicSubject(
  currentQuery:
    string,

  topicAnchor:
    string,
):
  boolean {

  const currentTerms =
    extractTopicSubjectTerms(
      currentQuery,
    );

  if (
    currentTerms.length ===
    0
  ) {
    return false;
  }


  const anchorTerms =
    extractTopicSubjectTerms(
      topicAnchor,
    );


  const sharedTerms =
    currentTerms.filter(
      (
        term,
      ) =>
        anchorTerms.includes(
          term,
        ),
    );


  if (
    sharedTerms.length >
    0
  ) {

    return false;
  }


  return true;
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
    
  ].some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

/*
 * ==================================================
 * Explicit context reset detection
 * ==================================================
 *
 * The customer can explicitly signal that the next
 * question should be treated as a fresh topic.
 *
 * This must take priority over follow-up detection.
 *
 * Examples:
 *
 * "Forget that. What is your address?"
 * "New question: what time do you open?"
 * "Separate question, do you offer physiotherapy?"
 * "Let's talk about something else."
 *
 * Provider-neutral and industry-neutral.
 * ==================================================
 */

function isExplicitContextResetRequest(
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


  return [
    /\bforget\s+(?:that|this|it)\b/i,

    /\bignore\s+(?:that|this|it)\b/i,

    /\bnew\s+question\b/i,

    /\bdifferent\s+question\b/i,

    /\bseparate\s+question\b/i,

    /\banother\s+question\b/i,

    /\blet'?s\s+talk\s+about\s+something\s+else\b/i,

    /\b(?:moving|move)\s+on\s+to\s+another\s+topic\b/i,

    /\b(?:change|switch)\s+(?:the\s+)?topic\b/i,

    /\bforget\s+the\s+previous\s+(?:question|topic)\b/i,

    /\bstart\s+(?:a\s+)?new\s+topic\b/i,
  ].some(
    (
      pattern,
    ) =>
      pattern.test(
        normalized,
      ),
  );
}

function removeExplicitContextResetPrefix(
  text:
    string,
):
  string {

  return text
    .replace(
      /^\s*(?:forget|ignore)\s+(?:that|this|it)[.!?,]?\s*/i,
      "",
    )
    .replace(
      /^\s*(?:new|different|separate|another)\s+question\s*[:,-]?\s*/i,
      "",
    )
    .replace(
      /^\s*(?:let'?s\s+)?(?:talk|move)\s+(?:about\s+)?something\s+else[.!?,]?\s*/i,
      "",
    )
    .trim();
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

/*
 * ==================================================
 * Implicit attribute follow-up detection
 * ==================================================
 *
 * Detects a grammatically complete question whose
 * requested information is an attribute of an already
 * established topic.
 *
 * Examples:
 *
 * "Where is Alam Impian?"
 * "What time do you open?"
 *
 * "Do you provide wound dressing?"
 * "How much does it cost?"
 *
 * These are different from explicit follow-ups such as
 * "What about the price?" because they contain no
 * backward-reference wording.
 * ==================================================
 */

function isImplicitAttributeFollowUp(
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
   * Explicit and elliptical follow-ups already have
   * their own context path.
   */

  if (
    isFollowUpPattern(
      text,
    ) ||
    isEllipticalFollowUp(
      text,
    )
  ) {

    return false;
  }


  /*
   * The implicit form must still be a complete question.
   */

  if (
    !isCompleteQuestion(
      text,
    )
  ) {

    return false;
  }


  const meaningfulTerms =
    extractMeaningfulTerms(
      text,
    );


  if (
    meaningfulTerms.length ===
    0
  ) {

    return false;
  }


  /*
   * Remove only attributes that commonly depend on
   * an already established entity/topic.
   */

  const subjectTerms =
    meaningfulTerms.filter(
      (
        term,
      ) =>
        !IMPLICIT_FOLLOW_UP_ATTRIBUTE_TERMS.has(
          term,
        ),
    );


  /*
   * No remaining subject means the question is asking
   * for an attribute of something already discussed.
   */

  return (
    subjectTerms.length ===
    0
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

/*
 * ==================================================
 * Root topic anchor
 * ==================================================
 *
 * The immediate topic anchor can itself be an
 * attribute-only follow-up.
 *
 * Example:
 *
 * 1. "Where is Alam Impian?"
 * 2. "What time do you open?"
 * 3. "How much is it?"
 *
 * The immediate anchor for message 3 may be:
 *
 * "What time do you open?"
 *
 * but the actual business entity is still:
 *
 * "Alam Impian"
 *
 * This resolver walks backwards to the latest
 * message containing a real topic/entity subject.
 *
 * Generic and industry-neutral.
 * ==================================================
 */

function selectTopicRootAnchor(
  messages:
    string[],

  topicAnchor:
    string |
    null,
):
  string |
  null {

  if (
    !topicAnchor
  ) {

    return null;
  }


  const anchorSubjectTerms =
    extractTopicSubjectTerms(
      topicAnchor,
    );


  /*
   * If the immediate anchor already contains a real
   * subject/entity, it is also the root anchor.
   */

  if (
    anchorSubjectTerms.length >
    0
  ) {

    return topicAnchor;
  }


  /*
   * Walk backwards through the available customer
   * context and find the latest message with a real
   * subject/entity.
   */

  for (
    let index =
      messages.length - 1;

    index >= 0;

    index -= 1
  ) {

    const candidate =
      messages[index];


    if (
      !candidate
    ) {

      continue;
    }


    const subjectTerms =
      extractTopicSubjectTerms(
        candidate,
      );


    if (
      subjectTerms.length >
      0
    ) {

      return candidate;
    }
  }


  return topicAnchor;
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
 * --------------------------------------------------
 * Explicit context reset
 * --------------------------------------------------
 *
 * Never allow previous customer context to leak into
 * a question when the customer explicitly requests a
 * new topic.
 * --------------------------------------------------
 */

if (
  isExplicitContextResetRequest(
    originalQuery,
  )
) {

  const resetQuery =
    removeExplicitContextResetPrefix(
      originalQuery,
    );


  return {
    originalQuery,

    retrievalQuery:
      resetQuery ||
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
  const implicitAttributeFollowUp =
  isImplicitAttributeFollowUp(
    originalQuery,
  );


    if (
      !isContextDependentQuery(
        originalQuery,
      ) &&
      !implicitAttributeFollowUp
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

const topicRootAnchor =
  selectTopicRootAnchor(
    deduplicatedContextMessages,
    topicAnchor,
  );

const explicitFollowUp =
  isFollowUpPattern(
    originalQuery,
  );

const ellipticalFollowUp =
  isEllipticalFollowUp(
    originalQuery,
  );

const topicSubjectAnchor =
  topicRootAnchor ??
  topicAnchor;

const topicSwitch =
  explicitFollowUp &&
  !!topicSubjectAnchor &&
  hasNewTopicSubject(
    originalQuery,
    topicSubjectAnchor,
  );

/*
 * --------------------------------------------------
 * Explicit topic/entity switch
 * --------------------------------------------------
 *
 * When the customer introduces a new subject during
 * an explicit follow-up, do not carry the old topic
 * into retrieval.
 * --------------------------------------------------
 */

  if (
    topicSwitch
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
 * An explicit or elliptical follow-up must retain
 * the latest meaningful customer topic even when
 * the new question introduces completely different
 * words.
 *
 * Example:
 *
 * Customer:
 * "Do you provide wound dressing?"
 *
 * Customer:
 * "What about the price?"
 *
 * "price" does not lexically overlap with
 * "wound dressing", but the second message still
 * depends on the first topic.
 */
const retainedTopic =
  topicRootAnchor ??
  topicAnchor;


if (
  filteredContextMessages.length ===
    0 &&
  (
    explicitFollowUp ||
    ellipticalFollowUp ||
    implicitAttributeFollowUp
  ) &&
  retainedTopic
) {

  return {
    originalQuery,

    retrievalQuery:
      [
        retainedTopic,
        originalQuery,
      ]
        .join(
          " ",
        )
        .slice(
          0,
          MAX_COMBINED_QUERY_CHARS,
        ),

    contextUsed:
      true,

    contextSource:
      retainedTopic,
  };
}


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
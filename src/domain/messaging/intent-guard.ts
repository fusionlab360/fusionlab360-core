import type {
  MessagingMessage,
} from "../../core/messaging";


/*
 * --------------------------------------------------
 * Intent types
 * --------------------------------------------------
 */

export type AIIntent =
  | "business"
  | "ai_meta"
  | "handoff_request";


export interface AIIntentDecision {

  intent:
    AIIntent;

  matched:
    boolean;
}


/*
 * --------------------------------------------------
 * Normalize multilingual text
 * --------------------------------------------------
 *
 * Supports:
 *
 * English
 * Malay
 * Manglish
 * Chinese
 * mixed-language messages
 *
 * Unicode letters/numbers are preserved.
 */

export function normalizeIntentText(
  text:
    string,
):
  string {

  return text
    .normalize(
      "NFKC",
    )
    .toLowerCase()
    .normalize(
      "NFD",
    )
    .replace(
      /\p{M}/gu,
      "",
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}


/*
 * --------------------------------------------------
 * Phrase matching
 * --------------------------------------------------
 *
 * IMPORTANT:
 *
 * Do NOT use raw String.includes() for every phrase.
 *
 * A phrase such as:
 *
 * "ai"
 *
 * must NOT match:
 *
 * availability
 * again
 * email
 *
 * Single-word Latin phrases therefore use token
 * boundaries.
 *
 * Multi-word phrases use normalized phrase boundaries.
 *
 * Chinese phrases remain substring searchable because
 * Chinese text normally has no word separators.
 */

function containsPhrase(
  text:
    string,

  phrase:
    string,
):
  boolean {

  const normalizedPhrase =
    normalizeIntentText(
      phrase,
    );


  if (
    !normalizedPhrase
  ) {

    return false;
  }


  /*
   * CJK:
   *
   * Chinese messages generally do not use spaces
   * between words, so substring matching is required.
   */

  if (
    /[\u3400-\u9fff]/u.test(
      normalizedPhrase,
    )
  ) {

    return text.includes(
      normalizedPhrase,
    );
  }


  /*
   * Latin / Malay / Manglish:
   *
   * Require word boundaries.
   */

  const escaped =
    normalizedPhrase
      .replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )
      .replace(
        /\s+/g,
        "\\s+",
      );


  const pattern =
    new RegExp(
      `(?:^|\\s)${escaped}(?:$|\\s)`,
      "u",
    );


  return pattern.test(
    text,
  );
}


/*
 * --------------------------------------------------
 * Match one phrase against text
 * --------------------------------------------------
 */

function containsAny(
  text:
    string,

  phrases:
    readonly string[],
):
  boolean {

  return phrases.some(
    (
      phrase,
    ) =>
      containsPhrase(
        text,
        phrase,
      ),
  );
}


/*
 * --------------------------------------------------
 * AI / Meta phrases
 * --------------------------------------------------
 *
 * These are deliberately narrow.
 *
 * A business question containing the word "AI"
 * should not automatically become an AI-meta question.
 */

const AI_META_PHRASES = [

  /*
   * ----------------------------------------------
   * English
   * ----------------------------------------------
   */

  "what is ai",

  "what is artificial intelligence",

  "what are you",

  "are you ai",

  "are you an ai",

  "are you chatgpt",

  "are you using chatgpt",

  "what model are you using",

  "what model do you use",

  "what platform are you using",

  "what platform do you use",

  "what technology are you using",

  "what technology do you use",

  "what are you built on",

  "who built you",

  "who created you",

  "how were you trained",

  "what were you trained on",

  "what is your training",

  "what do you learn from",

  "difference between you and chatgpt",

  "how are you different from chatgpt",

  "why are you different from chatgpt",

  "what makes you different from chatgpt",

  "what ai are you",

  "what llm are you using",

  "what model is behind you",

  "what software are you using",

  "how does your ai work",

  "how do you work",

  "how do you learn",


  /*
   * ----------------------------------------------
   * Malay / Manglish
   * ----------------------------------------------
   */

  "apa itu ai",

  "apa itu artificial intelligence",

  "apa itu kecerdasan buatan",

  "awak ai ke",

  "awak ai",

  "anda ai",

  "adakah awak ai",

  "awak guna chatgpt",

  "anda guna chatgpt",

  "model apa yang awak guna",

  "model apa awak guna",

  "platform apa yang awak guna",

  "platform apa awak guna",

  "teknologi apa yang awak guna",

  "siapa yang bina awak",

  "siapa bina awak",

  "macam mana awak dibina",

  "macam mana awak dilatih",

  "awak belajar dari mana",

  "apa beza awak dengan chatgpt",

  "macam mana awak berbeza dengan chatgpt",

  "macam mana ai awak berfungsi",

  "macam mana awak berfungsi",

  "macam mana awak belajar",


  /*
   * ----------------------------------------------
   * Chinese
   * ----------------------------------------------
   */

  "什么是ai",

  "什么是人工智能",

  "你是什么",

  "你是ai吗",

  "你是不是ai",

  "你是人工智能吗",

  "你是chatgpt吗",

  "你用什么模型",

  "你使用什么模型",

  "你是什么模型",

  "你用什么平台",

  "你使用什么平台",

  "你怎么训练",

  "你的训练数据",

  "谁开发你",

  "谁创建你",

  "你和chatgpt有什么不同",

  "你和chatgpt有什么区别",

  "你怎么工作",

  "你怎么学习",

] as const;


/*
 * --------------------------------------------------
 * AI continuation phrases
 * --------------------------------------------------
 *
 * These are only meaningful when the previous AI
 * response was itself an AI/meta discussion.
 */

const AI_CONTINUATION_PHRASES = [

  /*
   * English
   */

  "explain further",

  "explain more",

  "tell me more",

  "tell me more about that",

  "go on",

  "continue",

  "elaborate",

  "explain",

  "what do you mean",

  "what does that mean",

  "can you explain",

  "can you explain more",

  "can you explain that",

  "say more",

  "more",

  "how so",


  /*
   * Malay / Manglish
   */

  "terangkan lagi",

  "jelaskan lagi",

  "boleh terangkan",

  "boleh explain",

  "terangkan lebih lanjut",

  "cerita lagi",

  "sambung lagi",

  "apa maksudnya",

  "macam mana",

  "kenapa",


  /*
   * Chinese
   */

  "继续",

  "详细一点",

  "再解释一下",

  "多说一点",

  "可以详细一点吗",

  "什么意思",

  "怎么说",

  "为什么",

] as const;


/*
 * --------------------------------------------------
 * Human handoff phrases
 * --------------------------------------------------
 *
 * English
 * Malay / Manglish
 * Chinese
 */

const HUMAN_HANDOFF_PHRASES = [

  /*
   * ----------------------------------------------
   * English
   * ----------------------------------------------
   */

  "speak to a human",

  "talk to a human",

  "speak with a human",

  "talk with a human",

  "speak to someone",

  "talk to someone",

  "speak with someone",

  "talk with someone",

  "talk to a person",

  "speak to a person",

  "real person",

  "human agent",

  "human please",

  "real person please",

  "connect me to a person",

  "connect me to someone",

  "transfer me to a person",

  "transfer me to someone",

  "i want a human",

  "i want to speak to someone",

  "i want to talk to someone",

  "can i speak to someone",

  "can i talk to someone",

  "connect me to a human",

  "put me through to a human",

  "put me through to a person",

  "let me speak to a human",

  "let me speak to a person",

  "i need a human",

  "i need a real person",

  "i need to speak to a human",

  "i need to speak to a person",

  "i need to talk to a human",

  "i need to talk to a person",

  "stop the ai",

  "stop responding",

  "no more ai",

  "not the ai",

  "i don't want ai",

  "i dont want ai",


  /*
   * ----------------------------------------------
   * Malay / Manglish
   * ----------------------------------------------
   */

  "nak cakap dengan manusia",

  "nak bercakap dengan manusia",

  "nak cakap dengan orang",

  "nak bercakap dengan orang",

  "nak cakap dengan staff",

  "nak bercakap dengan staff",

  "nak cakap dengan staf",

  "nak bercakap dengan staf",

  "nak cakap dengan team",

  "nak bercakap dengan team",

  "saya nak manusia",

  "saya mahu manusia",

  "saya nak bercakap dengan manusia",

  "saya mahu bercakap dengan manusia",

  "saya nak bercakap dengan staff",

  "saya nak bercakap dengan staf",

  "saya mahu bercakap dengan staff",

  "saya mahu bercakap dengan staf",

  "boleh sambungkan saya kepada staff",

  "boleh sambungkan saya kepada staf",

  "boleh sambung saya ke staff",

  "boleh sambung saya ke staf",

  "tolong bagi saya manusia",

  "nak bercakap dengan team",

  "boleh sambungkan saya dengan team",


  /*
   * ----------------------------------------------
   * Chinese
   * ----------------------------------------------
   */

  "转人工",

  "转人工客服",

  "我要人工",

  "我要人工客服",

  "我要和真人说",

  "我想和真人聊",

  "我想找工作人员",

  "我要找工作人员",

  "可以转人工吗",

  "请帮我转人工",

  "我要和客服说",

  "转给客服",

  "我要人工处理",

  "我想找真人",

  "可以找真人吗",

] as const;


/*
 * --------------------------------------------------
 * Third-party referral phrases
 * --------------------------------------------------
 *
 * Used to detect when an AI-generated response has
 * started behaving like an intermediary.
 */

export const THIRD_PARTY_REFERRAL_PHRASES = [

  /*
   * ----------------------------------------------
   * English
   * ----------------------------------------------
   */

  "confirm with the property directly",

  "confirming with the property directly",

  "confirm with the hotel directly",

  "confirming with the hotel directly",

  "check with the property directly",

  "checking with the property directly",

  "check with the hotel directly",

  "checking with the hotel directly",

  "contact the property directly",

  "contacting the property directly",

  "contact the hotel directly",

  "contacting the hotel directly",

  "contact them directly",

  "contacting them directly",

  "find the contact information",

  "find contact information",

  "find the contact details",

  "find contact details",

  "get the contact information",

  "get contact information",

  "get the contact details",

  "get contact details",

  "property directly",

  "hotel directly",

  "contact the property",

  "contact the hotel",

  "check with the property",

  "check with the hotel",

  "confirm with the property",

  "confirm with the hotel",


  /*
   * ----------------------------------------------
   * Malay / Manglish
   * ----------------------------------------------
   */

  "hubungi pihak hotel",

  "hubungi pihak penginapan",

  "hubungi hotel terus",

  "hubungi mereka terus",

  "sahkan dengan pihak hotel",

  "sahkan dengan pihak penginapan",

  "semak dengan pihak hotel",

  "semak dengan pihak penginapan",

  "tanya pihak hotel",

  "cari nombor telefon hotel",

  "cari maklumat hubungan hotel",

  "cari contact hotel",


  /*
   * ----------------------------------------------
   * Chinese
   * ----------------------------------------------
   */

  "直接联系酒店",

  "联系酒店",

  "联系他们",

  "找酒店联系方式",

  "找酒店的联系方式",

  "直接向酒店确认",

  "请联系酒店",

  "联系酒店确认",

] as const;


/*
 * --------------------------------------------------
 * AI/meta signal detection in previous AI response
 * --------------------------------------------------
 *
 * These are used only when a short customer follow-up
 * such as:
 *
 * "explain further"
 *
 * follows an earlier AI response.
 *
 * IMPORTANT:
 *
 * "ai" is intentionally retained, but token matching
 * prevents it from matching "availability", "again",
 * "email", etc.
 */

const AI_META_SIGNALS = [

  "ai",

  "artificial intelligence",

  "chatgpt",

  "language model",

  "llm",

  "machine learning",

  "training",

  "trained",

  "platform",

  "technology",

  "software",

  "model",

  "how i work",

  "how i learn",

  "kecerdasan buatan",

  "model apa",

  "teknologi",

  "macam mana saya berfungsi",

  "什么是人工智能",

  "人工智能",

  "模型",

  "平台",

  "训练",

] as const;


/*
 * --------------------------------------------------
 * Direct AI/meta detection
 * --------------------------------------------------
 */

export function isAIMetaQuestion(
  text:
    string,
):
  boolean {

  const normalized =
    normalizeIntentText(
      text,
    );


  if (
    !normalized
  ) {

    return false;
  }


  /*
   * --------------------------------------------------
   * Direct AI identity / implementation questions
   * --------------------------------------------------
   *
   * These are handled deterministically by Core and
   * must not reach the LLM.
   */

  const directAIMetaPatterns = [

    /*
     * AI / model identity
     */

    /\bwhat\s+(ai\s+)?model\b/i,

    /\bwhich\s+(ai\s+)?model\b/i,

    /\bwhat\s+model\s+are\s+you\b/i,

    /\bwhich\s+model\s+are\s+you\b/i,

    /\bwhat\s+ai\s+are\s+you\b/i,

    /\bwhich\s+ai\s+are\s+you\b/i,

    /\bwhat\s+kind\s+of\s+ai\s+are\s+you\b/i,

    /\bwhat\s+type\s+of\s+ai\s+are\s+you\b/i,

    /\bare\s+you\s+(an?\s+)?ai\b/i,

    /\bare\s+you\s+chatgpt\b/i,

    /\bare\s+you\s+openai\b/i,

    /\bare\s+you\s+gemini\b/i,

    /\bare\s+you\s+claude\b/i,

    /*
     * AI provider / technology
     */

    /\bwhat\s+(ai\s+)?provider\b/i,

    /\bwhich\s+(ai\s+)?provider\b/i,

    /\bwhat\s+technology\s+(are|do)\s+you\b/i,

    /\bwhat\s+platform\s+(are|do)\s+you\b/i,

    /\bwhat\s+system\s+(are|do)\s+you\b/i,

    /\bwhat\s+engine\s+(are|do)\s+you\b/i,

    /\bwhat\s+llm\b/i,

    /\bwhich\s+llm\b/i,

    /\bwhat\s+large\s+language\s+model\b/i,

    /*
     * Implementation details
     */

    /\bhow\s+(are|were)\s+you\s+(built|made|trained)\b/i,

    /\bhow\s+were\s+you\s+trained\b/i,

    /\bwhat\s+are\s+you\s+trained\s+on\b/i,

    /\bwhat\s+is\s+your\s+training\b/i,

    /\bwhat\s+technology\s+do\s+you\s+use\b/i,

    /\bwhat\s+software\s+do\s+you\s+use\b/i,

    /\bwhat\s+api\s+do\s+you\s+use\b/i,

    /\bwhat\s+backend\s+do\s+you\s+use\b/i,

    /\bwhat\s+model\s+provider\s+do\s+you\s+use\b/i,

    /*
     * Common conversational forms
     */

    /\btell\s+me\s+what\s+ai\s+you\s+use\b/i,

    /\btell\s+me\s+which\s+ai\s+you\s+use\b/i,

    /\btell\s+me\s+what\s+model\s+you\s+use\b/i,

    /\btell\s+me\s+which\s+model\s+you\s+use\b/i,

    /\bwhat\s+is\s+this\s+ai\b/i,

    /\bwhat\s+ai\s+is\s+this\b/i,

  ];


  if (
    directAIMetaPatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  ) {

    return true;
  }


  /*
   * --------------------------------------------------
   * Other existing AI-meta terms
   * --------------------------------------------------
   *
   * Preserve broader legacy detection.
   */

  const aiTerms = [

    "artificial intelligence",

    "ai assistant",

    "ai bot",

    "chatbot",

    "language model",

    "machine learning",

    "neural network",

    "openai",

    "chatgpt",

    "gemini",

    "claude",

    "llama",

  ];


  const hasAITerm =
    aiTerms.some(
      (
        term,
      ) =>
        normalized.includes(
          term,
        ),
    );


  const metaQuestionPatterns = [

    /\?$/u,

    /^(what|which|who|how|are|is|can|could|tell|explain|who)\b/i,

    /\b(what|which|who|how)\b/i,

  ];


  return (
    hasAITerm &&
    metaQuestionPatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          normalized,
        ),
    )
  );
}
/*
 * --------------------------------------------------
 * Human handoff request detection
 * --------------------------------------------------
 */

export function isHumanHandoffRequest(
  text:
    string,
):
  boolean {

  const normalized =
    normalizeIntentText(
      text,
    );


  return containsAny(
    normalized,

    HUMAN_HANDOFF_PHRASES,
  );
}


/*
 * --------------------------------------------------
 * AI continuation detection
 * --------------------------------------------------
 *
 * Example:
 *
 * Customer:
 *   What is AI?
 *
 * AI:
 *   I'm mainly here to help with...
 *
 * Customer:
 *   Explain further
 *
 * The second message is ambiguous on its own.
 *
 * We inspect the most recent AI response to determine
 * whether this is continuing an AI/meta discussion.
 */

export function isAIContinuationQuestion(
  text:
    string,

  history:
    MessagingMessage[],
):
  boolean {

  const normalized =
    normalizeIntentText(
      text,
    );


  /*
   * Only short continuation phrases are handled here.
   */

  if (
    !containsAny(
      normalized,

      AI_CONTINUATION_PHRASES,
    )
  ) {

    return false;
  }


  /*
   * Get the most recent AI-generated response.
   */

  const previousAIMessage =
    [...history]
      .filter(
        (
          item,
        ) =>

          item.senderType ===
            "ai" &&

          item.text
            .trim()
            .length > 0,
      )
      .sort(
        (
          a,
          b,
        ) =>
          new Date(
            b.timestamp,
          ).getTime() -
          new Date(
            a.timestamp,
          ).getTime(),
      )[0];


  if (
    !previousAIMessage
  ) {

    return false;
  }


  const previousText =
    normalizeIntentText(
      previousAIMessage.text,
    );


  /*
   * The previous AI response must clearly contain
   * AI/meta signals.
   */

  return containsAny(
    previousText,

    AI_META_SIGNALS,
  );
}


/*
 * --------------------------------------------------
 * Classify inbound AI intent
 * --------------------------------------------------
 *
 * Priority:
 *
 * 1. Human request
 * 2. AI/meta
 * 3. AI/meta continuation
 * 4. Business
 *
 * A customer saying:
 *
 * "Are you AI? I want a human."
 *
 * must therefore become:
 *
 * handoff_request
 *
 * rather than:
 *
 * ai_meta
 */

export function classifyInboundAIIntent(
  text:
    string,

  history:
    MessagingMessage[] =
      [],
):
  AIIntentDecision {

  /*
   * ------------------------------------------------
   * Human request has highest priority
   * ------------------------------------------------
   */

  if (
    isHumanHandoffRequest(
      text,
    )
  ) {

    return {

      intent:
        "handoff_request",

      matched:
        true,
    };
  }


  /*
   * ------------------------------------------------
   * Direct AI/meta question
   * ------------------------------------------------
   */

  if (
    isAIMetaQuestion(
      text,
    )
  ) {

    return {

      intent:
        "ai_meta",

      matched:
        true,
    };
  }


  /*
   * ------------------------------------------------
   * Contextual AI/meta continuation
   * ------------------------------------------------
   */

  if (
    isAIContinuationQuestion(
      text,

      history,
    )
  ) {

    return {

      intent:
        "ai_meta",

      matched:
        true,
    };
  }


  /*
   * ------------------------------------------------
   * Normal business message
   * ------------------------------------------------
   */

  return {

    intent:
      "business",

    matched:
      false,
  };
}


/*
 * --------------------------------------------------
 * AI-generated handoff offer detection
 * --------------------------------------------------
 *
 * Used after the model produces a reply.
 *
 * Third-party referral language is also considered
 * a handoff signal because the response sanitizer
 * will convert it into first-party wording.
 */

export function isHandoffOffer(
  text:
    string,
):
  boolean {

  const normalized =
    normalizeIntentText(
      text,
    );


  const handoffSignals = [

    /*
     * ----------------------------------------------
     * English
     * ----------------------------------------------
     */

    "member of the team",

    "someone from the team",

    "someone on the team",

    "our team can help",

    "our team can assist",

    "our team can confirm",

    "our team will help",

    "our team will assist",

    "our team will confirm",

    "i can pass your request to our team",

    "i can pass this to our team",

    "i can get our team to confirm",

    "i can check with our team",

    "i can confirm with our team",

    "would you like me to pass this to our team",

    "would you like me to connect you with our team",

    "shall i pass this to our team",

    "shall i check with our team",


    /*
     * ----------------------------------------------
     * Malay / Manglish
     * ----------------------------------------------
     */

    "pasukan kami boleh bantu",

    "pasukan kami boleh semak",

    "pasukan kami boleh sahkan",

    "saya boleh sampaikan permintaan anda kepada pasukan kami",

    "saya boleh sampaikan permintaan ini kepada pasukan kami",

    "saya boleh semak dengan pasukan kami",

    "saya boleh sahkan dengan pasukan kami",

    "nak saya sampaikan kepada pasukan kami",

    "nak saya semak dengan pasukan kami",

    "nak saya bantu sambungkan",


    /*
     * ----------------------------------------------
     * Chinese
     * ----------------------------------------------
     */

    "我们的团队可以帮您",

    "我们的团队可以确认",

    "我可以把您的请求交给我们的团队确认",

    "我可以帮您转给我们的团队",

    "需要我帮您转给我们的团队吗",

  ];


  if (
    containsAny(
      normalized,

      handoffSignals,
    )
  ) {

    return true;
  }


  /*
   * Third-party referral is treated as a handoff
   * candidate so the response sanitizer can convert it.
   */

  return containsAny(
    normalized,

    THIRD_PARTY_REFERRAL_PHRASES,
  );
}
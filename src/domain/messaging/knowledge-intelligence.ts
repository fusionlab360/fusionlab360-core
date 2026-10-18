import type { WorkerVersionIdentity } from "./inbound-diagnostics";

/*
 * --------------------------------------------------
 * Retrieval Intelligence
 * --------------------------------------------------
 *
 * Provider-neutral knowledge analysis.
 *
 * This module does NOT call Gemini, Cloudflare, or
 * any other LLM.
 *
 * It prepares, ranks, and selects retrieved approved
 * knowledge before generation.
 *
 * Design goals:
 *
 * 1. Natural conversational retrieval.
 * 2. Strong semantic matches should not be rejected
 *    merely because exact keywords are absent.
 * 3. Exact and lexical matches remain stronger.
 * 4. Entity-specific knowledge should outrank generic
 *    fallback knowledge when the customer names an entity.
 * 5. High-risk business facts remain conservative.
 * 6. No tenant-specific facts are hardcoded here.
 * 7. Handoff is the fallback when approved knowledge
 *    genuinely cannot support the answer.
 *
 * --------------------------------------------------
 */

export interface KnowledgeContextItem {
  title: string;
  sourceType: string;
  content: string;
  score: number;

  id?: string;
  knowledgeSourceId?: string;
  providerDocumentId?: string;
  chunkIndex?: number;

  retrievalMethod?: "vector" | "lexical" | "hybrid";
  rrfScore?: number;
  vectorRank?: number;
  lexicalRank?: number;
  lexicalScore?: number;
  rerankerScore?: number;
  rerankerRank?: number;
}

export type KnowledgeIntent =
  | "greeting"
  | "services"
  | "price"
  | "discount"
  | "promotion"
  | "availability"
  | "booking"
  | "facilities"
  | "location"
  | "hours"
  | "staff"
  | "package"
  | "medical"
  | "contact"
  | "general";

export interface KnowledgeQueryAnalysis {

  /*
   * Primary intent retained for backward compatibility.
   */

  intent:
    KnowledgeIntent;

  /*
   * All detected intents for compound questions.
   *
   * Example:
   *
   * "What is the check-out time and is there any charge?"
   *
   * [
   *   "hours",
   *   "price"
   * ]
   */

  intents:
    KnowledgeIntent[];

  language:
    | "en"
    | "ms"
    | "zh"
    | "other";

  terms:
    string[];

  focusPhrases:
    string[];

  highRisk:
    boolean;

  requiresBusinessEvidence:
    boolean;
}

export interface RankedKnowledgeItem
  extends KnowledgeContextItem {
  rerankScore:
    number;
  matchedTerms:
    string[];
  matchedFocusPhrases:
    string[];
  titleMatch:
    boolean;
  intentMatch:
    boolean;

  focusPhraseMatch:
    boolean;

    exactPhraseMatch:
    boolean;

  entityMatch:
    boolean;

  entityTermMatches:
    string[];

  entityTermCount:
    number;

  entityTitleOverlapCount:
    number;

  entityContentOverlapCount:
    number;

  fallbackLike:
    boolean;

  retrievalMethod?:
    "vector" | "lexical" | "hybrid";

    rrfScore?:
    number;

  vectorRank?: number;
  lexicalRank?: number;
  lexicalScore?: number;
}

export interface KnowledgeSelectionCandidateDiagnostic {
  rank: number;
  title: string;
  sourceType: string;
  sourceKey: string | null;
  chunkId: string | null;
  knowledgeSourceId: string | null;
  providerDocumentId: string | null;
  chunkIndex: number | null;
  retrievalMethod: string;
  rrfScore: number | null;
  vectorRank: number | null;
  lexicalRank: number | null;
  lexicalScore: number | null;
  score: number;
  rerankScore: number;
  rerankerScore: number | null;
  rerankerRank: number | null;
  entityMatch: boolean;
  fallbackLike: boolean;
  intentMatch: boolean;
  focusPhraseMatch: boolean;
  exactPhraseMatch: boolean;
  matchedTerms: string[];
  entityTermCount: number;
  entityTokenOverlapCount: number;
  requestedAttributeSupport: Array<{
    intent: KnowledgeIntent;
    attribute: KnowledgeRequestedAttribute;
    attributeEvidence: boolean;
    entityEvidence: boolean;
    supported: boolean;
  }>;
  eligibilityPaths: Array<{
    path: string;
    passed: boolean;
    failedGates: string[];
  }>;
  decision:
    | "selected"
    | "eligible_not_selected"
    | "rejected";
  rejectionReason: string | null;
}


/*
 * --------------------------------------------------
 * Configuration
 * --------------------------------------------------
 *
 * These thresholds distinguish between:
 *
 * - high-risk factual requests
 * - ordinary business information
 *
 * Ordinary business information may use strong
 * semantic evidence even when lexical overlap is weak.
 * --------------------------------------------------
 */

const NORMAL_VECTOR_THRESHOLD =
  0.70;

const HIGH_RISK_VECTOR_THRESHOLD =
  0.80;

const NORMAL_RERANK_THRESHOLD =
  0.78;

const HIGH_RISK_RERANK_THRESHOLD =
  0.88;

/*
 * Strong semantic rescue.
 */

const SEMANTIC_RESCUE_VECTOR_THRESHOLD =
  0.64;

const SEMANTIC_RESCUE_RERANK_THRESHOLD =
  0.75;

/*
 * Moderate semantic rescue.
 */

const SUPPORTED_RESCUE_VECTOR_THRESHOLD =
  0.58;

const SUPPORTED_RESCUE_RERANK_THRESHOLD =
  0.72;

// These words describe an entity's type or role; by themselves they do not
// identify a particular tenant, branch, or location.
const GENERIC_ENTITY_DESCRIPTORS = new Set([
  "business",
  "company",
  "clinic",
  "hospital",
  "branch",
  "location",
  "outlet",
  "office",
  "store",
  "shop",
  "centre",
  "center",
  "organization",
  "organisation",
  "practice",
]);

/*
 * Exact phrase matches.
 */
const EXACT_PHRASE_VECTOR_THRESHOLD =
  0.55;

const EXACT_PHRASE_RERANK_THRESHOLD =
  0.70;

/*
 * Entity-aware ranking.
 */

const ENTITY_TITLE_BOOST =
  0.18;

const ENTITY_CONTENT_BOOST =
  0.10;

const ENTITY_EXACT_PHRASE_BOOST =
  0.05;

/*
 * Generic fallback documents should not outrank an
 * entity-specific document merely because they contain
 * words such as "number", "contact", "phone", etc.
 */

const GENERIC_FALLBACK_PENALTY =
  0.16;

const MAX_SELECTED_RESULTS =
  6;

const MAX_RESULTS_PER_SOURCE =
  2;

/*
 * --------------------------------------------------
 * Stop words
 * --------------------------------------------------
 */

const STOP_WORDS =
  new Set<string>([
    /*
     * English
     */
    "hi",
    "hello",
    "hey",
    "hai",
    "helo",
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "if",
    "then",
    "than",
    "that",
    "this",
    "these",
    "those",
    "with",
    "from",
    "for",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "it",
    "its",
    "we",
    "our",
    "you",
    "your",
    "they",
    "their",
    "them",
    "i",
    "me",
    "my",
    "mine",
    "can",
    "could",
    "would",
    "should",
    "will",
    "may",
    "might",
    "must",
    "do",
    "does",
    "did",
    "have",
    "has",
    "had",
    "please",
    "tell",
    "give",
    "show",
    "know",
    "want",
    "need",
    "about",
    "what",
    "which",
    "where",
    "when",
    "who",
    "why",
    "how",

    /*
     * Malay / Manglish
     */

    "apa",
    "adakah",
    "ada",
    "tak",
    "tidak",
    "yang",
    "ini",
    "itu",
    "dan",
    "atau",
    "dengan",
    "untuk",
    "dari",
    "saya",
    "kami",
    "awak",
    "anda",
    "nak",
    "mahu",
    "ingin",
    "boleh",
    "berapa",
    "tahu",
    "bila",
    "siapa",
    "mana",
    "perkhidmatan",
    "servis",


    /*
     * Chinese function words
     */

    "什么",
    "哪里",
    "哪儿",
    "什么时候",
    "多少",
    "谁",
    "可以",
    "请问",
    "有没有",
    "这是",
    "这个",
    "那个",

  ]);

/*
 * --------------------------------------------------
 * Query attribute vocabulary
 * --------------------------------------------------
 *
 * These words describe WHAT the user wants rather
 * than WHICH entity they are asking about.
 *
 * Everything else is a candidate entity term.
 * --------------------------------------------------
 */

const ATTRIBUTE_TERMS_BY_INTENT:
  Record<
    KnowledgeIntent,
    Set<string>
  > = {

  greeting:
    new Set<string>([
     "hi",
     "hello",
      "hey",
     "hai",
     "helo",
    ]),

  services:
 new Set<string>([
    "service",
    "services",
    "servis",
    "treatment",
    "treatments",
    "rawatan",
    "offering",
    "offerings",
    "offer",
    "offers",
    "provide",
    "provides",
    "provided",
  ]),



  price:

    new Set<string>([
      "price",
      "prices",
      "cost",
      "costs",
      "fee",
      "fees",
      "rate",
      "rates",
      "pricing",
      "harga",
      "kos",
      "yuran",
      "bayaran",
      "rm",
      "myr",
      "inr",
      "rs",
      "ringgit",
      "charge",
      "charges",

    ]),



  discount:

    new Set<string>([
      "discount",
      "discounts",
      "diskaun",
      "promotion",
      "promotions",
     "promo",
      "promosi",
      "offer",
      "offers",
      "deal",
      "deals",
      "voucher",
      "coupon",
    ]),



  promotion:

    new Set<string>([

      "promotion",
      "promotions",
      "promo",
      "promosi",
      "offer",
     "offers",
      "deal",
      "deals",
      "voucher",
      "coupon",
    ]),



  availability:

    new Set<string>([

      "available",
      "availability",
      "slot",
      "slots",
      "vacancy",
      "appointment",
      "appointments",
      "ketersediaan",
      "kosong",
    ]),



  facilities:

    new Set<string>([

      "facility",
      "facilities",
      "amenity",
      "amenities",
      "parking",
     "car park",
      "parking area",
      "wifi",
      "wi-fi",
      "internet",
      "toilet",
      "toilets",
      "restroom",
     "washroom",
     "lift",
      "elevator",
     "wheelchair",
      "accessible",
      "waiting area",
      "tempat letak kereta",
      "tandas",
      "lif",

    ]),



  booking:

    new Set<string>([

      "book",
      "booking",
      "bookings",
      "reserve",
     "reservation",
      "reservations",
      "appointment",
      "appointments",
      "tempah",
      "tempahan",
      "temujanji",

    ]),



  location:

    new Set<string>([

      "branch",
      "branches",
      "location",
      "locations",
      "where",
     "address",
      "alamat",
      "cawangan",
      "lokasi",
    ]),



  hours:

    new Set<string>([
      "open",
      "opening",
      "closing",
      "hours",
      "operating",
      "time",
      "times",
      "waktu",
      "buka",
      "tutup",
    ]),



  staff:

    new Set<string>([

      "doctor",
      "doctors",
      "staff",
      "specialist",
      "specialists",

     "doktor",
      "staf",
    ]),

  package:
    new Set<string>([

     "package",
      "packages",
      "pakej",
    ]),


 medical:
    new Set<string>([
     "medical",

     "medicine",
      "medication",
      "treatment",
      "symptom",
      "diagnosis",

     "rawatan",
      "ubat",
      "suntikan",
      "injection",
    ]),


  contact:
    new Set<string>([
      "phone",
      "mobile",
      "number",
      "contact",
      "call",

     "whatsapp",
      "email",
      "telephone",
      "telefon",

     "emel",
      "hubungi",
    ]),


 general:
    new Set<string>(),
};


/*
 * --------------------------------------------------
 * Normalization
 * --------------------------------------------------
 */


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
      /[^\p{L}\p{N}%₹$.\-]+/gu,
      " ",
    )
    .replace(

     /\s+/g,
      " ",
    )
    .trim();
}

function isMapLinkRequest(query: string): boolean {
  return (
    /\b(?:map|maps|location|directions?)\b.{0,32}\b(?:link|url)\b/i.test(query) ||
    /\b(?:link|url)\b.{0,32}\b(?:map|maps|location|directions?)\b/i.test(query) ||
    /\bgoogle\s+maps?\b/i.test(query)
  );
}

function hasMapLinkEvidence(value: string): boolean {
  return /https?:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(?:[/?#][^\s<>"')\]]*)?/i.test(
    value,
  );
}

function hasLocationAttributeEvidence(value: string): boolean {
  const normalized = normalize(value);
  const unavailableValue = /^(?:n\/?a|none|unknown|not provided|not available|not known)$/i;
  const labeledAddress = /\b(?:address|alamat)\s*[:\-]\s*([^\r\n;]+)/i.exec(value)?.[1]?.trim();

  if (labeledAddress && !unavailableValue.test(normalize(labeledAddress))) {
    return true;
  }

  const streetAddress =
    /\b\d{1,6}(?:[\/-][\w-]+)?\s+(?:jalan|jln|road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|lorong|persiaran|lebuh|highway|hwy\.)\b/i.test(
      normalized,
    );
  const locatedPlace =
    /\b(?:located|situated|based)\s+(?:at|in)\s+([^\r\n.;]+)/i.exec(value)?.[1]?.trim();

  return streetAddress || Boolean(
    locatedPlace && !unavailableValue.test(normalize(locatedPlace)),
  );
}

/*

* --------------------------------------------------
 * Extract meaningful terms
 * --------------------------------------------------
 */


function tokenizeKnowledgeText(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "");

  const chunks =
    normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [];

  return chunks.flatMap((chunk) => {
    // Chinese text has no dependable whitespace boundaries.
    // Include both individual characters and adjacent pairs
    // so short Chinese phrases can match across documents.
    if (/^\p{Script=Han}+$/u.test(chunk)) {
      const characters = Array.from(chunk);

      if (characters.length <= 1) {
        return characters;
      }

      return [
        ...characters,
        ...characters
          .slice(0, -1)
          .map((character, index) =>
            `${character}${characters[index + 1]}`,
          ),
      ];
    }

    // Splitting punctuation also separates values such as 9am-5pm.
    return [chunk];
  });
}

function stemKnowledgeToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    token.length > 5 &&
    /(?:ches|shes|xes|zes|sses)$/.test(token)
  ) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function extractTerms(value: string): string[] {
  return [
    ...new Set(
      tokenizeKnowledgeText(value)
        .map(stemKnowledgeToken)
        .filter(
          (token) =>
            token.length >= 2 &&
            !STOP_WORDS.has(token) &&
            !/^\d+$/u.test(token),
        ),
    ),
  ];
}




/*

 * --------------------------------------------------

 * Extract query entity terms

 * --------------------------------------------------

 *

 * Example:

 *

 * Query:

 * "What is the Alam Impian mobile number?"

 *

 * Query terms:

 *   alam

 *   impian

 *   mobile

 *   number

 *

 * Contact attributes:

 *   mobile

 *   number

 *

 * Entity terms:

 *   alam

 *   impian

 *

 * This allows a document titled:

 *

 * "Alam Impian Details"

 *

 * to outrank:

 *

 * "If knowledge base don't have answer give this number"

 *

 * without hardcoding any branch name.

 * --------------------------------------------------

 */



function extractEntityTerms(
  value:
    string,

  intent:
    KnowledgeIntent |
    KnowledgeIntent[],
):
  string[] {

  const terms =
    extractTerms(
      value,
    );


  const intents =
    Array.isArray(
      intent,
    )
      ? intent
      : [
          intent,
        ];


  return terms.filter(
    (
      term,
    ) =>
      !GENERIC_ENTITY_DESCRIPTORS.has(term) &&
      !intents.some(
        (
          currentIntent,
        ) =>
          (
            ATTRIBUTE_TERMS_BY_INTENT[
              currentIntent
            ] ??
            new Set<string>()
          ).has(
            term,
          ),
      ),
  );
}

function extractQueryEntityTerms(
  question: string,
  retrievalAnalysis: KnowledgeQueryAnalysis,
  analysisQuestion: string,
  analysis: KnowledgeQueryAnalysis,
): string[] {
  return [
    ...new Set([
      ...extractEntityTerms(question, retrievalAnalysis.intents),
      ...extractEntityTerms(analysisQuestion, analysis.intents),
    ]),
  ];
}

export interface KnowledgeQueryEntityComparison {
  resolvedEntityTermCount: number;
  selectorEntityTermCount: number;
  sharedEntityTermCount: number;
  resolvedEntityPreserved: boolean | null;
}

/** Compare entity terms using the same extraction rules as candidate ranking. */
export function compareKnowledgeQueryEntityContext(
  resolvedRetrievalQuery: string,
  resolvedAnalysisQuery: string,
  selectorRetrievalQuery: string,
  selectorAnalysisQuery: string,
): KnowledgeQueryEntityComparison {
  const resolvedRetrievalAnalysis = analyzeKnowledgeQuery(resolvedRetrievalQuery);
  const resolvedAnalysis = analyzeKnowledgeQuery(resolvedAnalysisQuery);
  const selectorRetrievalAnalysis = analyzeKnowledgeQuery(selectorRetrievalQuery);
  const selectorAnalysis = analyzeKnowledgeQuery(selectorAnalysisQuery);
  const resolvedTerms = extractQueryEntityTerms(
    resolvedRetrievalQuery,
    resolvedRetrievalAnalysis,
    resolvedAnalysisQuery,
    resolvedAnalysis,
  );
  const selectorTerms = extractQueryEntityTerms(
    selectorRetrievalQuery,
    selectorRetrievalAnalysis,
    selectorAnalysisQuery,
    selectorAnalysis,
  );
  const selectorTermSet = new Set(selectorTerms);
  const sharedEntityTermCount = resolvedTerms.filter((term) => selectorTermSet.has(term)).length;

  return {
    resolvedEntityTermCount: resolvedTerms.length,
    selectorEntityTermCount: selectorTerms.length,
    sharedEntityTermCount,
    resolvedEntityPreserved: resolvedTerms.length === 0
      ? null
      : sharedEntityTermCount === resolvedTerms.length,
  };
}



/*

 * --------------------------------------------------

 * Entity phrase

 * --------------------------------------------------

 */



function buildEntityPhrases(

  entityTerms:

    string[],

):

  string[] {



  if (

    entityTerms.length <

    2

  ) {

    return [];

  }



  const phrases:

    string[] = [];



  for (

    let size =

      Math.min(

        4,

        entityTerms.length,

      );

    size >= 2;

    size -= 1

  ) {



    for (

      let index = 0;

      index + size <=

        entityTerms.length;

      index += 1

    ) {



      const phrase =

        entityTerms

          .slice(

            index,

            index + size,

          )

          .join(

            " ",

          );



      if (

        phrase.length >=

        5

      ) {

        phrases.push(

          phrase,

        );

      }

    }

  }



  return [

    ...new Set(

      phrases,

    ),

  ];

}



/*

 * --------------------------------------------------

 * Extract generic query focus phrases

 * --------------------------------------------------

 */



function extractFocusPhrases(

  value:

    string,

):

  string[] {



  const normalized =

    normalize(

      value,

    );



  const terms =

    extractTerms(

      normalized,

    );



  if (

    terms.length <

    2

  ) {

    return [];

  }



  const phrases =

    new Set<string>();



  for (

    let length =

      4;

    length >=

      2;

    length -=

      1

  ) {



    for (

      let index =

        0;



      index + length <=

        terms.length;



      index +=

        1

    ) {



      const phrase =

        terms

          .slice(

            index,

            index + length,

          )

          .join(

            " ",

          );



      if (

        phrase.length <

        6

      ) {

        continue;

      }



      phrases.add(

        phrase,

      );

    }

  }



  return [

    ...phrases,

  ].slice(

    0,

    8,

  );

}



/*

 * --------------------------------------------------

 * Language detection

 * --------------------------------------------------

 */



function detectLanguage(

  text:

    string,

):

  KnowledgeQueryAnalysis["language"] {



  if (

    /[\u3400-\u9fff]/u.test(

      text,

    )

  ) {

    return "zh";

  }



  const normalized =

    normalize(

      text,

    );



  const malayTerms = [

    "apa",

    "ada",

    "berapa",

    "boleh",

    "nak",

    "mahu",

    "harga",

    "diskaun",

    "promosi",

    "servis",

    "perkhidmatan",

    "rawatan",

    "doktor",

    "cawangan",

    "temujanji",

    "tempahan",

  ];



  const matches =

    malayTerms.filter(

      (

        term,

      ) =>

        normalized.includes(

          term,

        ),

    ).length;



  if (

    matches >=

    1

  ) {

    return "ms";

  }



  return "en";

}



/*

 * --------------------------------------------------

 * Intent detection

 * --------------------------------------------------

 */



function detectIntent(
  text:
    string,
):
  KnowledgeIntent {

  const normalized =
    normalize(
      text,
    );

  /*
   * Greeting
   */

  if (
    /^(?:hi|hello|hey|hai|helo)(?:\s+(?:there|team|everyone))?[.!?]*$/i.test(
  normalized,
)
  ) {
    return "greeting";
  }

  /*
   * Discount
   */
  if (
    /\b(discount|discounts|diskaun)\b/i.test(
      normalized,
    )
  ) {
    return "discount";
  }


    /*
   * Service catalogue questions must be classified before
   * the promotion rules because "offer" is also a common
   * verb in questions about services.
   *
   * Explicit promotion terms retain promotion precedence.
   */
  const hasExplicitPromotionMention =
    /\b(promotion|promotions|promo|promosi|discount|discounts|diskaun|deal|deals|voucher|vouchers|coupon|coupons)\b|\bspecial\s+offers?\b/i.test(
      normalized,
    );

  const asksForServiceCatalogue =
    /\b(which|what)\s+(services?|treatments?)\b/i.test(
      normalized,
    );

  const asksAboutServiceCapability =
    /\b(?:do|does|can)\b.{0,100}\b(?:provide|offer|perform|carry)\b/i.test(
      normalized,
    ) &&
    !/\b(address|location|where|map|maps|directions|alamat|lokasi)\b/i.test(
      normalized,
    );

  if (
    asksForServiceCatalogue &&
    !hasExplicitPromotionMention
  ) {
    return "services";
  }

  /*
   * Promotion
   */
  if (
    hasExplicitPromotionMention ||
    (/\b(?:offer|offers)\b/i.test(normalized) && !asksAboutServiceCapability)
  ) {
    return "promotion";
  }

  /*
   * Price
   */
  if (
    /\b(price|prices|cost|costs|fee|fees|rate|rates|pricing|harga|kos|yuran|bayaran|charge|charges)\b/i.test(
  normalized,
) ||
    /\bhow\s+much\b/i.test(
      normalized,
    )
  ) {
    return "price";
  }

  /*
   * Facilities / amenities
   *
   * This must come before availability because a question such as
   * "Do you have any parking available?" is asking about a facility,
   * not an appointment or slot.
   */
  if (
    /\b(facility|facilities|amenity|amenities|parking|car park|parking area|wifi|wi-fi|internet|toilet|toilets|restroom|washroom|lift|elevator|wheelchair|accessible|waiting area)\b/i.test(
      normalized,
    ) ||
    /\b(tempat letak kereta|tandas|lif)\b/i.test(
      normalized,
    )
  ) {
    return "facilities";
  }

  /*
   * Availability
   */

  if (

    /\b(available|availability|slot|slots|vacancy|ketersediaan|kosong)\b/i.test(
      normalized,
    )
  ) {
    return "availability";
  }

  /*
   * Booking
   */

  if (
    /\b(book|booking|bookings|reserve|reservation|reservations|appointment|appointments|tempah|tempahan|temujanji)\b/i.test(
      normalized,
    )
  ) {
    return "booking";
  }

  /*
   * Contact
   */

  if (

    /\b(phone|mobile|number|contact|call|whatsapp|email|telephone|telefon|emel|hubungi)\b/i.test(

      normalized,

    )

  ) {

    return "contact";

  }



  /*

   * Hours

   */

  if (

    /\b(open|opening|closing|hours|operating|waktu|buka|tutup)\b/i.test(

      normalized,

    )
    ||

    /\b(check[\s-]?out|check[\s-]?in)\s+time\b/i.test(
      normalized,
    )

    ||

    /\bwhat\s+time\b/i.test(

      normalized,

    ) ||

    /\bwhat\s+time\s+does\b/i.test(

      normalized,

    ) ||

    /\bwhen\s+does\b/i.test(

      normalized,

    ) ||

    /\bwhen\s+do\b/i.test(

      normalized,

    ) ||

    /\bwhen\s+is\b/i.test(

      normalized,

    ) ||

    /\bwhat\s+are\s+your\s+hours\b/i.test(

      normalized,

    )

  ) {

    return "hours";

  }



  /*

   * Service capability verbs commonly accompany a specific
   * service name without using the word "service". Resolve
   * those questions before treating a named branch as the
   * requested location attribute.

   */

  if (asksAboutServiceCapability) {
    return "services";
  }



  /*

   * A named branch is often an entity modifier in an
   * opening-hours question, not the requested attribute.
   * Detect the requested hours attribute before location.

   */

  /*

   * Location

   */

  if (

    /\b(branch|branches|location|locations|where|address|alamat|cawangan|lokasi)\b/i.test(

      normalized,

    )

  ) {

    return "location";

  }



  /*

   * Services

   */

  if (
    /\b(service|services|servis|treatment|treatments|rawatan|what\s+do\s+you\s+offer|what\s+services)\b/i.test(
      normalized,
    )
  ) {
    return "services";
  }



  /*

   * Staff

   */

  if (

    /\b(doctor|doctors|staff|specialist|specialists|doktor|staf)\b/i.test(

      normalized,

    )

  ) {

    return "staff";

  }



  /*

   * Package

   */

  if (

    /\b(package|packages|pakej)\b/i.test(

      normalized,

    )

  ) {

    return "package";

  }



  /*

   * Medical

   */

  if (

    /\b(medical|medicine|medication|symptom|diagnosis|ubat|suntikan|injection)\b/i.test(

      normalized,

    ) ||

    /\btreatment\b/i.test(

      normalized,

    )

  ) {

    return "medical";

  }



  return "general";

}


/*
 * --------------------------------------------------
 * Multi-intent detection
 * --------------------------------------------------
 *
 * Detect multiple business intents without introducing
 * industry-specific rules.
 *
 * Examples:
 *
 * Hotel:
 * "What is the check-out time and is there any charge?"
 *
 * -> hours
 * -> price
 *
 * Clinic:
 * "Do you provide physiotherapy and wound care?"
 *
 * -> services
 *
 * Hotel:
 * "Do you have parking and airport transfer?"
 *
 * -> facilities
 * -> services
 *
 * The existing detectIntent() remains responsible for
 * primary single-intent classification.
 * --------------------------------------------------
 */

function splitIntentClauses(
  text:
    string,
):
  string[] {

  const normalized =
    normalize(
      text,
    );


  if (
    !normalized
  ) {

    return [];
  }


  return normalized
    .split(
      /\s+(?:and|also|plus|as\s+well\s+as|&)\s+/i,
    )
    .map(
      (
        part,
      ) =>
        part.trim(),
    )
    .filter(
      (
        part,
      ) =>
        part.length >= 3,
    );
}


function detectIntents(
  text:
    string,
):
  KnowledgeIntent[] {

  const clauses =
    splitIntentClauses(
      text,
    );


  const detected: KnowledgeIntent[] = [];


  /*
   * Always preserve the original question as the first
   * classification. This prevents a split clause from
   * accidentally replacing the primary intent.
   */

  const primaryIntent =
    detectIntent(
      text,
    );


  if (
    primaryIntent !==
    "general"
  ) {

    detected.push(
      primaryIntent,
    );
  }


  /*
   * Analyze individual clauses when the question appears
   * to contain more than one topic.
   */

  if (
    clauses.length >
    1
  ) {

    for (
      const clause of
        clauses
    ) {

      const intent =
        detectIntent(
          clause,
        );


      if (
        intent ===
        "general"
      ) {

        continue;
      }


      if (
        !detected.includes(
          intent,
        )
      ) {

        detected.push(
          intent,
        );
      }
    }
  }


  /*
   * If nothing specific was detected, retain general.
   */

  if (
    detected.length ===
    0
  ) {

    return [
      "general",
    ];
  }


  return detected;
}


/*

 * --------------------------------------------------

 * Determine whether approved business knowledge

 * is required

 * --------------------------------------------------

 */



function requiresBusinessEvidence(

  intent:

    KnowledgeIntent,

):

  boolean {



  return [

    "services",

    "price",

    "discount",

    "promotion",

    "availability",

    "booking",

    "facilities",

    "location",

    "hours",

    "staff",

    "package",

    "medical",

    "contact",

  ].includes(

    intent,

  );

}

/*
 * --------------------------------------------------
 * Business-fact question detection
 * --------------------------------------------------
 *
 * Intent classification is deliberately conservative.
 *
 * A customer can still ask a business-specific question
 * without using one of our explicit intent keywords.
 *
 * Examples:
 *
 * - "Do you provide wound dressing?"
 * - "Do you offer physiotherapy?"
 * - "Can you provide this service?"
 * - "Is this available?"
 * - "What is your WhatsApp number?"
 * - "Can I get this at your clinic?"
 *
 * These questions must still require approved business
 * knowledge even when detectIntent() returns "general".
 * --------------------------------------------------
 */

function looksLikeBusinessFactQuestion(
  question:
    string,
): boolean {

  const normalized =
    normalize(
      question,
    );


  if (
    !normalized
  ) {

    return false;
  }


  /*
   * Explicit business-service / capability questions.
   */

  if (
    /\bdo\s+you\s+(provide|offer|have|perform|carry)\b/i.test(
      normalized,
    )
  ) {

    return true;
  }


  if (
    /\bcan\s+you\s+(provide|offer|perform|do)\b/i.test(
      normalized,
    )
  ) {

    return true;
  }


  if (
    /\bis\s+.+\b(available|offered|provided)\b/i.test(
      normalized,
    )
  ) {

    return true;
  }


  /*
   * Customer requests for business information.
   *
   * These are intentionally broad enough to capture
   * natural wording without hardcoding individual
   * services or branch names.
   */

  const businessFactPatterns = [

    /\b(address|location|branch|branches|located|situated)\b/i,

    /\b(phone|mobile|telephone|whatsapp|email|contact)\b/i,

    /\b(service|services|treatment|treatments|facility|facilities)\b/i,

    /\b(doctor|doctors|staff|specialist|specialists)\b/i,

    /\b(appointment|appointments|booking|bookings)\b/i,

    /\b(price|prices|cost|costs|fee|fees|charge|charges|pricing)\b/i,

    /\b(hours|opening|closing|operating)\b/i,

    /\b(policy|policies|promotion|promotions|discount|discounts)\b/i,

    /\b(available|availability)\b/i,

  ];


  if (
    businessFactPatterns.some(
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


  return false;
}


/*

 * --------------------------------------------------

 * High-risk intents

 * --------------------------------------------------

 */



function isHighRiskIntent(

  intent:

    KnowledgeIntent,

):

  boolean {



  return [

    "price",

    "discount",

    "promotion",

    "availability",

    "booking",

    "medical",

    "package",

  ].includes(

    intent,

  );

}



/*

 * --------------------------------------------------

 * Intent evidence terms

 * --------------------------------------------------

 */



function getIntentTerms(

  intent:

    KnowledgeIntent,

):

  string[] {



  switch (

    intent

  ) {



  case "services":

  return [
    "service",
    "services",
    "servis",
    "treatment",
    "treatments",
    "rawatan",
    "offering",
    "offerings",
    "offer",
    "offers",
    "provide",
    "provides",
    "provided",
  ];



 case "price":

  return [
    "price",
    "prices",
    "cost",
    "costs",
    "fee",
    "fees",
    "rate",
    "rates",
    "pricing",
    "harga",
    "kos",
    "yuran",
    "bayaran",
    "charge",
    "charges",
    "rm",
    "myr",
    "inr",
    "rs",
    "ringgit",
  ];



    case "discount":

      return [

        "discount",

        "diskaun",

        "promotion",

        "promosi",

        "promo",

        "offer",

        "offers",

        "deal",

        "voucher",

      ];



    case "promotion":

      return [

        "promotion",

        "promotions",

        "promosi",

        "promo",

        "offer",

        "offers",

        "deal",

        "voucher",

        "coupon",

      ];



    case "availability":

      return [

        "available",

        "availability",

        "slot",

        "vacancy",

        "appointment",

        "booking",

        "kosong",

      ];



    case "booking":

      return [

        "book",

        "booking",

        "reservation",

        "appointment",

        "tempah",

        "tempahan",

        "temujanji",

      ];



    case "facilities":

      return [

        "facility",

        "facilities",

        "amenity",

        "amenities",

        "parking",

        "car park",

        "parking area",

        "wifi",

        "wi-fi",

        "internet",

        "toilet",

        "toilets",

        "restroom",

        "washroom",

        "lift",

        "elevator",

        "wheelchair",

        "accessible",

        "waiting area",

        "tempat letak kereta",

        "tandas",

        "lif",

      ];



    case "location":

      return [

        "branch",

        "branches",

        "location",

        "locations",

        "address",

        "alamat",

        "cawangan",

        "lokasi",

      ];



    case "hours":

      return [
        "open",
        "opening",
        "closing",
        "hours",
        "operating",
        "time",
        "times",
        "business hours",
        "opening hours",
        "operating hours",
        "clinic hours",
        "waktu operasi",
        "waktu buka",
        "waktu tutup",
        "buka",
        "tutup",
      ];



    case "staff":

      return [

        "doctor",

        "doctors",

        "staff",

        "specialist",

        "doktor",

        "staf",

      ];



    case "package":

      return [

        "package",

        "packages",

        "pakej",

      ];



    case "medical":

      return [

        "medical",

        "medicine",

        "medication",

        "treatment",

        "rawatan",

        "injection",

        "suntikan",

      ];



    case "contact":

      return [

        "phone",

        "mobile",

        "number",

        "contact",

        "call",

        "whatsapp",

        "email",

        "telephone",

        "telefon",

        "emel",

        "hubungi",

      ];



    default:

      return [];

  }

}



/*

 * --------------------------------------------------

 * Token overlap

 * --------------------------------------------------

 */



function calculateOverlap(

  queryTerms:

    string[],



  candidateTerms:

    string[],

):

  {

    ratio:

      number;



    matched:

      string[];

  } {



  const candidateSet =

    new Set(

      candidateTerms,

    );



  const matched =

    queryTerms.filter(

      (

        term,

      ) =>

        candidateSet.has(

          term,

        ),

    );



  return {

    ratio:

      queryTerms.length ===

      0

        ? 0

        : matched.length /

          queryTerms.length,



    matched,

  };

}

/*
 * --------------------------------------------------
 * Entity token similarity
 * --------------------------------------------------
 *
 * Generic typo-tolerant matching.
 *
 * This is intentionally provider-neutral.
 * --------------------------------------------------
 */

function normalizeEntityToken(
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
      /[-_]/g,
      "",
    )
    .replace(
      /[^\p{L}\p{N}]/gu,
      "",
    );

}

function levenshteinDistance(
  left:
    string,
  right:
    string,
):
  number {

  if (
    left === right
  ) {
    return 0;
  }

  if (
    left.length === 0
  ) {
    return right.length;
  }

  if (
    right.length === 0
  ) {
    return left.length;
  }

  const previous =
    Array.from(
      {
        length:
          right.length + 1,
      },
      (
        _,
        index,
      ) =>
        index,
    );

  for (
    let i = 1;
    i <= left.length;
    i += 1
  ) {

    const current =
      new Array<number>(
        right.length + 1,
      );

    current[0] =
      i;

    for (
      let j = 1;
      j <= right.length;
      j += 1
    ) {

      const substitutionCost =
        left[i - 1] ===
        right[j - 1]
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] +
            substitutionCost,
        );

    }

    for (
      let j = 0;
      j < current.length;
      j += 1
    ) {

      previous[j] =
        current[j];

    }

  }

  return previous[
    right.length
  ];

}

function entityTokenSimilarity(
  left:
    string,

  right:
    string,
):
  number {

  const a =
    normalizeEntityToken(
      left,
    );

  const b =
    normalizeEntityToken(
      right,
    );

  if (
    !a ||
    !b
  ) {
    return 0;
  }

  if (
    a === b
  ) {
    return 1;
  }

  /*
   * Simple plural normalization.
   */
  const singularA =
    a.endsWith("s") &&
    a.length > 4
      ? a.slice(
          0,
          -1,
        )
      : a;

  const singularB =
    b.endsWith("s") &&
    b.length > 4
      ? b.slice(
          0,
          -1,
        )
      : b;

  if (
    singularA ===
    singularB
  ) {
    return 0.98;
  }

  /*
   * Common customer typo:
   * adjacent character transposition.
   *
   * Example:
   *
   * impain
   * impian
   */
  if (
    a.length ===
      b.length
  ) {

    let firstMismatch =
      -1;

    let secondMismatch =
      -1;

    for (
      let index = 0;
      index < a.length;
      index += 1
    ) {

      if (
        a[index] !==
        b[index]
      ) {

        if (
          firstMismatch ===
          -1
        ) {

          firstMismatch =
            index;

        } else if (
          secondMismatch ===
          -1
        ) {

          secondMismatch =
            index;

        } else {

          break;

        }

      }

    }

    if (
      firstMismatch >= 0 &&
      secondMismatch ===
        firstMismatch + 1 &&
      a[firstMismatch] ===
        b[secondMismatch] &&
      a[secondMismatch] ===
        b[firstMismatch]
    ) {

      return 0.95;

    }

  }

  const distance =
    levenshteinDistance(
      a,
      b,
    );

  const maxLength =
    Math.max(
      a.length,
      b.length,
    );

  if (
    maxLength === 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    1 -
      distance /
        maxLength,
  );

}

function getEntitySimilarityThreshold(
  value:
    string,
):
  number {

  const normalized =
    normalizeEntityToken(
      value,
    );

  /*
   * Very short words are dangerous to fuzzy-match.
   */
  if (
    normalized.length <= 3
  ) {
    return 1;
  }

  if (
    normalized.length <= 5
  ) {
    return 0.80;
  }

  return 0.72;

}

/*

 * --------------------------------------------------

 * Entity overlap

 * --------------------------------------------------

 */



function calculateEntityOverlap(
  entityTerms:
    string[],
  candidateTerms:
    string[],
):
  {
    ratio:
      number;

    matched:
      string[];

  } {

  if (
    entityTerms.length ===
    0 ||
    candidateTerms.length ===
    0
  ) {

    return {

      ratio:
        0,

      matched:
        [],

    };

  }

  const matched:
    string[] = [];

  for (
    const entityTerm of
      entityTerms
  ) {

    const threshold =
      getEntitySimilarityThreshold(
        entityTerm,
      );

    let bestSimilarity =
      0;

    for (
      const candidateTerm of
        candidateTerms
    ) {

      const similarity =
        entityTokenSimilarity(
          entityTerm,
          candidateTerm,
        );

      if (
        similarity >
        bestSimilarity
      ) {

        bestSimilarity =
          similarity;

      }

    }

    if (
      bestSimilarity >=
      threshold
    ) {

      matched.push(
        entityTerm,
      );

    }

  }

  return {

    ratio:
      matched.length /
      entityTerms.length,

    matched,

  };

}


/*

 * --------------------------------------------------

 * Exact phrase match

 * --------------------------------------------------

 */



function hasExactPhrase(

  question:

    string,



  content:

    string,

):

  boolean {



  const normalizedQuestion =

    normalize(

      question,

    );



  if (

    normalizedQuestion.length <

    5

  ) {

    return false;

  }



  return normalize(

    content,

  ).includes(

    normalizedQuestion,

  );

}



/*

 * --------------------------------------------------

 * Entity phrase match

 * --------------------------------------------------

 */



function hasEntityPhraseMatch(

  entityTerms:

    string[],



  title:

    string,



  content:

    string,

):

  boolean {



  if (

    entityTerms.length <

    2

  ) {

    return false;

  }



  const phrases =

    buildEntityPhrases(

      entityTerms,

    );



  const normalizedTitle =

    normalize(

      title,

    );



  const normalizedContent =

    normalize(

      content,

    );



  return phrases.some(

    (

      phrase,

    ) =>

      normalizedTitle.includes(

        phrase,

      ) ||

      normalizedContent.includes(

        phrase,

      ),

  );

}



/*

 * --------------------------------------------------

 * Intent evidence

 * --------------------------------------------------

 */



function hasIntentEvidence(

  intent:
    KnowledgeIntent,
  content:
    string,
):
  boolean {

  const normalizedContent =
    normalize(
      content,
    );


  return getIntentTerms(

    intent,

  ).some(

    (

      term,

    ) =>

      normalizedContent.includes(

        normalize(

          term,

        ),

      ),

  );

}

function hasAnyIntentEvidence(
  intents:
    KnowledgeIntent[],

  content:
    string,
):
  boolean {

  return intents.some(
    (
      intent,
    ) =>
      hasIntentEvidence(
        intent,
        content,
      ),
  );
}

/*

 * --------------------------------------------------

 * Generic fallback detection

 * --------------------------------------------------

 *

 * These are knowledge entries that behave more like a

 * catch-all fallback than an entity-specific source.

 *

 * They remain usable when no specific entity knowledge

 * exists, but they should not outrank a source that

 * actually matches the entity the customer asked about.

 * --------------------------------------------------

 */



function isGenericFallbackKnowledge(

  item:

    KnowledgeContextItem,

):

  boolean {



  const combined =

    normalize(

      [

        item.title,

        item.content,

      ].join(

        " ",

      ),

    );



  const patterns = [

    /\bif\s+knowledge\s+base\b/i,

    /\bif\s+the\s+knowledge\s+base\b/i,

    /\bif\s+kb\b/i,

    /\bif\s+we\s+don't\s+have\b/i,

    /\bif\s+we\s+do\s+not\s+have\b/i,

    /\bif\s+you\s+don't\s+have\b/i,

    /\bif\s+you\s+do\s+not\s+have\b/i,

    /\bdon't\s+have\s+(the\s+)?answer\b/i,

    /\bdo\s+not\s+have\s+(the\s+)?answer\b/i,

    /\bgive\s+this\s+number\b/i,

    /\buse\s+this\s+number\b/i,

    /\bdefault\s+(phone|mobile|contact)\b/i,

    /\bdefault\s+number\b/i,
  ];

  return patterns.some(
    (
      pattern,
    ) =>
      pattern.test(
        combined,
      ),
  );
}


/*
 * --------------------------------------------------
 * Query analysis
 * --------------------------------------------------
 */

export function analyzeKnowledgeQuery(
  question:
    string,
):
  KnowledgeQueryAnalysis {

  const intents =
    detectIntents(
      question,
    );


  const intent =
    intents[0] ??
    "general";


  return {

    intent,

    intents,

    language:
      detectLanguage(
        question,
      ),

    terms:
      extractTerms(
        question,
      ),

    focusPhrases:
      extractFocusPhrases(
        question,
      ),

    highRisk:
      intents.some(
        (
          currentIntent,
        ) =>
          isHighRiskIntent(
            currentIntent,
          ),
      ),

    requiresBusinessEvidence:
      intents.some(
        (
          currentIntent,
        ) =>
          requiresBusinessEvidence(
            currentIntent,
          ),
      ) ||

      looksLikeBusinessFactQuestion(
        question,
      ),

  };
}

/*
 * --------------------------------------------------
 * Rank retrieved knowledge
 * --------------------------------------------------
 *
 * The ranking order is now:
 *
 * 1. semantic score
 * 2. lexical relevance
 * 3. title relevance
 * 4. entity relevance
 * 5. focus phrase relevance
 * 6. exact phrase relevance
 * 7. intent relevance
 *
 * Entity relevance is deliberately stronger than generic
 * intent/title matching.
 *
 * This is what prevents:
 *
 * "If knowledge base don't have answer give this number"
 *
 * from beating:
 *
 * "Alam Impian Details"
 *
 * for:
 *
 * "What is the Alam Impian mobile number?"
 * --------------------------------------------------
 */

export function rerankKnowledge(

  question:
    string,

  knowledge:
    KnowledgeContextItem[],

  analysisQuestion:
    string =
      question,
):

  RankedKnowledgeItem[] {

  const retrievalAnalysis =
  analyzeKnowledgeQuery(
    question,
  );

  const analysis =
    analyzeKnowledgeQuery(
      analysisQuestion,
    );

    const entityTerms = extractQueryEntityTerms(
      question,
      retrievalAnalysis,
      analysisQuestion,
      analysis,
    );

  return knowledge

    .filter(
      (
        item,
      ) =>
        item.content
          .trim()
          .length >
        0,
    )
    .map(
      (
        item,
      ) => {

        const contentTerms =
          extractTerms(
            item.content,
          );

        const titleTerms =
          extractTerms(
            item.title,
          );



        const contentOverlap =
          calculateOverlap(
            retrievalAnalysis.terms,
            contentTerms,
          );



        const titleOverlap =
          calculateOverlap(
            retrievalAnalysis.terms,
            titleTerms,
          );

        const entityTitleOverlap =
          calculateEntityOverlap(
            entityTerms,
            titleTerms,
          );

        const entityContentOverlap =
          calculateEntityOverlap(
            entityTerms,
            contentTerms,
          );

        const exactPhraseMatch =
          hasExactPhrase(
            question,
            item.content,
          );

        const intentMatch =
          hasAnyIntentEvidence(
            analysis.intents,
            item.content,
          );

        const matchedFocusPhrases =
          analysis.focusPhrases.filter(
            (
              phrase,
            ) => {

        const normalizedPhrase =
                normalize(
                  phrase,
                );

        const normalizedTitle =
                normalize(
                  item.title,
                );

        const normalizedContent =
                normalize(
                  item.content,
                );

              return (
                normalizedTitle.includes(
                  normalizedPhrase,
                ) ||
                normalizedContent.includes(
                  normalizedPhrase,
                )
              );
            },
          );

        const focusPhraseMatch =
          matchedFocusPhrases.length >
          0;

        const entityPhraseMatch =
          hasEntityPhraseMatch(
            entityTerms,
            item.title,
            item.content,
          );

        const entityTermMatches = [
          ...new Set([
            ...entityTitleOverlap.matched,
            ...entityContentOverlap.matched,
          ]),

        ];



        const entityMatch =
          entityTerms.length >
          0 &&
          (
            entityTitleOverlap.ratio >=
              0.5 ||
            entityContentOverlap.ratio >=
              0.75 ||
            entityPhraseMatch
          );

        const fallbackLike =
          isGenericFallbackKnowledge(
            item,
          );



        /*
         * Start from the vector score.
         */

        let rerankScore =
        item.score;

      if (
        item.retrievalMethod === "lexical"
      ) {
        // A lexical match is not a vector similarity score.
        // This is only a ranking prior; eligibility is checked separately.
        rerankScore += 0.45;
      }

      if (
        typeof item.rrfScore === "number"
      ) {
        rerankScore += Math.min(
          item.rrfScore * 2,
          0.08,
        );
      }


        /*
         * Lexical content agreement.
         */
        rerankScore +=
          contentOverlap.ratio *
          0.15;



        /*
         * Title agreement.
         */

        rerankScore +=

          titleOverlap.ratio *
          0.10;

          /*
         * Entity content match.
         */

        if (
          entityContentOverlap.ratio >

          0

        ) {

          rerankScore +=
            entityContentOverlap.ratio *
            ENTITY_CONTENT_BOOST;
        }

        /*
         * Exact entity phrase.
         */

        if (
          entityPhraseMatch
        ) {
          rerankScore +=
            ENTITY_EXACT_PHRASE_BOOST;
        }

        /*
         * Focus phrase agreement.
         */
        if ( focusPhraseMatch ) {
          rerankScore += 0.12;

        if (
            matchedFocusPhrases.length >= 2
          ) {
            rerankScore += 0.05;
          }
        }

        /*
         * Exact question match.
         */
        if (
          exactPhraseMatch
        ) {
          rerankScore += 0.12;
        }

        /*
         * Intent evidence.
         */
        if (
          intentMatch
        ) {
         rerankScore += 0.08;
        }

        /*
         * Generic fallback penalty.
         *
         * Only penalize it when the query actually
         * identifies an entity.
         *
         * This means the fallback remains usable when
         * there is no specific entity knowledge.
         */
        if (
          fallbackLike &&
          entityTerms.length >
          0 &&
          !entityMatch
        ) {
          rerankScore -=
            GENERIC_FALLBACK_PENALTY;
        }
        /*
         * Keep score within 0..1.
         */
        rerankScore =
          Math.max(
            0,
            Math.min(
              1,
              rerankScore,
            ),
          );

        return {
          ...item,
          rerankScore,
          matchedTerms: contentOverlap.matched,
          matchedFocusPhrases,
          titleMatch: titleOverlap.ratio > 0,
          intentMatch,
          focusPhraseMatch,
          exactPhraseMatch,
          entityMatch,
          entityTermMatches,
          entityTermCount: entityTerms.length,
          entityTitleOverlapCount: entityTitleOverlap.matched.length,
          entityContentOverlapCount: entityContentOverlap.matched.length,
          fallbackLike,
        };
      },
    )

.sort((a, b) => {
  // Prefer genuine neural scores when both candidates have them.
  // Scores are used for ordering only, not eligibility.
  const aHasNeuralScore =
    typeof a.rerankerScore === "number" &&
    Number.isFinite(a.rerankerScore);

  const bHasNeuralScore =
    typeof b.rerankerScore === "number" &&
    Number.isFinite(b.rerankerScore);

  if (
    aHasNeuralScore &&
    bHasNeuralScore &&
    a.rerankerScore !== b.rerankerScore
  ) {
    return (
  (b.rerankerScore as number) -
  (a.rerankerScore as number)
);
  }

  // Fall back to the existing heuristic when scores are
  // missing or tied.
  if (b.rerankScore !== a.rerankScore) {
    return b.rerankScore - a.rerankScore;
  }



        /*

         * Entity-specific knowledge wins ties.

         */

        if (

          b.entityMatch !==

          a.entityMatch

        ) {

          return b.entityMatch

            ? 1

            : -1;

        }



        /*

         * Non-fallback knowledge wins ties.

         */

        if (

          b.fallbackLike !==

          a.fallbackLike

        ) {

          return b.fallbackLike

            ? -1

            : 1;

        }



        return (

          b.score -

          a.score

        );

      },

    );

}



/*

 * --------------------------------------------------

 * Selection helpers

 * --------------------------------------------------

 */



function hasSupportingEvidence(

  item:

    RankedKnowledgeItem,

):

  boolean {



  return (

    item.entityMatch ||

    item.titleMatch ||

    item.intentMatch ||

    item.focusPhraseMatch ||

    item.exactPhraseMatch ||

    item.matchedTerms.length >

      0

  );

}

function hasExplicitServiceOfferingEvidence(
  item: RankedKnowledgeItem,
): boolean {
  const content = normalize(item.content);
  if (/\b(?:customer|help|support)\s+services?\b|\bservices?\s+(?:desk|department|team|area)\b/i.test(content)) {
    return false;
  }
  return (
    /\b(?:services?|treatments?)\s*[:\-]\s*\S/i.test(content) ||
    /\b(?:services?|treatments?)\b.{0,80}\b(?:include|provid\w*|offer\w*|available|consist of|are|is)\b/i.test(content) ||
    /\b(?:provid\w*|offer\w*|perform\w*|deliver\w*)\b.{0,80}\b(?:services?|treatments?)\b/i.test(content)
  );
}



/*

 * --------------------------------------------------

 * Entity-specific candidate detection

 * --------------------------------------------------

 *

 * Used to keep generic fallback sources out when an

 * actual entity-specific source exists.

 * --------------------------------------------------

 */



function hasStrongEntityCandidate(
 ranked:
   RankedKnowledgeItem[],
):
  boolean {

   return ranked.some(
    (item) =>
      (
        item.entityMatch &&
        item.rerankScore >= 0.68 &&
        item.score >= 0.55
      ) ||
      (
        item.retrievalMethod === "lexical" &&
        item.entityMatch &&
        (item.lexicalRank ?? Infinity) <= 3 &&
        item.rerankScore >= 0.68
      ),
  );
}

/*
 * --------------------------------------------------
 * Knowledge document identity
 * --------------------------------------------------
 *
 * Used to prevent the same logical knowledge document
 * from being selected more than once.
 *
 * This is intentionally provider-neutral and
 * industry-neutral.
 * --------------------------------------------------
 */

function getKnowledgeDocumentKey(
  item:
    KnowledgeContextItem,
):
  string {

  return [
    item.sourceType
      ?.trim()
      .toLowerCase() ??
      "",

    item.title
      ?.trim()
      .toLowerCase() ??
      "",

    normalize(
      item.content,
    ),
  ].join(
    "|",
  );
}

/*
 * --------------------------------------------------
 * Requested intent coverage
 * --------------------------------------------------
 *
 * Determine whether a knowledge item provides evidence
 * for a specific requested intent.
 *
 * This is intentionally provider-neutral and
 * industry-neutral.
 * --------------------------------------------------
 */

function supportsRequestedIntent(
  item:
    RankedKnowledgeItem,

  intent:
    KnowledgeIntent,
):
  boolean {

  if (
    intent ===
    "general"
  ) {

    return false;
  }

  return (
  hasIntentEvidence(
    intent,
    item.content,
  ) ||

  hasIntentEvidence(
    intent,
    item.title,
  ) ||
  (intent === "location" && hasMapLinkEvidence(item.content)) ||
  (intent === "location" && hasMapLinkEvidence(item.title))
);
}

/*
 * --------------------------------------------------
 * Selected knowledge intent coverage
 * --------------------------------------------------
 *
 * Determines which requested business intents are
 * supported by the currently selected knowledge.
 *
 * This remains generic across:
 *
 * - clinic
 * - hotel
 * - future industries
 *
 * No business-specific terminology is used here.
 * --------------------------------------------------
 */

function getKnowledgeIntentCoverage(
  intents:
    KnowledgeIntent[],

  selected:
    RankedKnowledgeItem[],
):
  {
    covered:
      KnowledgeIntent[];

    missing:
      KnowledgeIntent[];
  } {

  const requestedIntents =
    [
      ...new Set(
        intents.filter(
          (
            intent,
          ) =>
            intent !==
            "general",
        ),
      ),
    ];


  const covered =
    requestedIntents.filter(
      (
        intent,
      ) =>
        selected.some(
          (
            item,
          ) =>
            supportsRequestedIntent(
              item,
              intent,
            ),
        ),
    );


  const missing =
    requestedIntents.filter(
      (
        intent,
      ) =>
        !covered.includes(
          intent,
        ),
    );


  return {
    covered,
    missing,
  };
}

/*
 * --------------------------------------------------
 * Attribute-level answerability
 * --------------------------------------------------
 *
 * Intent tells us WHAT broad category the customer
 * is asking about.
 *
 * Attribute tells us WHAT information is required.
 *
 * This remains industry-neutral.
 * --------------------------------------------------
 */

type KnowledgeRequestedAttribute =
  | "time"
  | "price"
  | "location"
  | "map_link"
  | "contact"
  | "availability"
  | "service"
  | "facility"
  | "staff"
  | "package"
  | "discount"
  | "promotion"
  | "booking"
  | "medical"
  | "general";


export interface KnowledgeAttributeRequirement {

  intent:
    KnowledgeIntent;

  attribute:
    KnowledgeRequestedAttribute;
}


export interface KnowledgeAttributeCoverage {

  requested:
    KnowledgeAttributeRequirement[];

  covered:
    KnowledgeAttributeRequirement[];

  missing:
    KnowledgeAttributeRequirement[];
}


function getPrimaryAttributeForIntent(
  intent:
    KnowledgeIntent,
  query = "",
):
  KnowledgeRequestedAttribute {

  switch (
    intent
  ) {

    case "hours":
      return "time";

    case "price":
      return "price";

    case "location":
      return isMapLinkRequest(query)
        ? "map_link"
        : "location";

    case "contact":
      return "contact";

    case "availability":
      return "availability";

    case "services":
      return "service";

    case "facilities":
      return "facility";

    case "staff":
      return "staff";

    case "package":
      return "package";

    case "discount":
      return "discount";

    case "promotion":
      return "promotion";

    case "booking":
      return "booking";

    case "medical":
      return "medical";

    default:
      return "general";
  }
}

function hasRequestedAttributeEvidence(
  item:
    RankedKnowledgeItem,

  requirement:
    KnowledgeAttributeRequirement,
  query = "",
):
  boolean {

  const combined =
    normalize(
      [
        item.title,
        item.content,
      ].join(
        " ",
      ),
    );


  switch (
    requirement.attribute
  ) {

    case "time":

      return (
        /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(
          combined,
        ) ||

        /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(
          combined,
        ) ||

        /\b(opening hours|operating hours|business hours|clinic hours|opening time|closing time|check[\s-]?in time|check[\s-]?out time)\b/i.test(
          combined,
        ) ||

        /\b(waktu buka|waktu tutup|waktu operasi)\b/i.test(
          combined,
        )
      );


    case "price":

      return (
        hasIntentEvidence(
          "price",
          combined,
        ) ||

        /\b(?:rm|myr)\s*\d/i.test(
          combined,
        ) ||

        /\b\d[\d,]*(?:\.\d+)?\s*(?:ringgit|myr)\b/i.test(
          combined,
        )
      );


    case "location":

      return hasLocationAttributeEvidence(combined);

    case "map_link":

      return hasMapLinkEvidence(
        [item.title, item.content].join(" "),
      );


    case "contact":

      return hasIntentEvidence(
        "contact",
        combined,
      );


    case "availability":

      return hasIntentEvidence(
        "availability",
        combined,
      );


    case "service":

      return hasIntentEvidence(
        "services",
        combined,
      );


    case "facility":

      return hasIntentEvidence(
        "facilities",
        combined,
      );


    case "staff":

      return hasIntentEvidence(
        "staff",
        combined,
      );


    case "package":

      return hasIntentEvidence(
        "package",
        combined,
      );


    case "discount":

      return hasIntentEvidence(
        "discount",
        combined,
      );


    case "promotion":

      return hasIntentEvidence(
        "promotion",
        combined,
      );


    case "booking":

      return hasIntentEvidence(
        "booking",
        combined,
      );


    case "medical":

      return hasIntentEvidence(
        "medical",
        combined,
      );


    default:

      return false;
  }
}

function supportsRequestedAttribute(
  item:
    RankedKnowledgeItem,

  requirement:
    KnowledgeAttributeRequirement,

  entityTerms:
    string[],
  query = "",
):
  boolean {

  if (
    !hasRequestedAttributeEvidence(
      item,
      requirement,
      query,
    )
  ) {

    return false;
  }


  /*
   * If the customer identified an entity,
   * the attribute evidence must belong to
   * an entity-matching document.
   *
   * This prevents:
   *
   * "check-out charge"
   *
   * from being answered by an unrelated
   * generic pricing document.
   */

  if (
    entityTerms.length >
    0
  ) {

    return item.entityMatch;
  }


  return true;
}

function getKnowledgeAttributeCoverage(
  intents:
    KnowledgeIntent[],

  entityTerms:
    string[],

  selected:
    RankedKnowledgeItem[],
  query = "",
):
  KnowledgeAttributeCoverage {

  const requested =
    [
      ...new Map(
        intents
          .filter(
            (
              intent,
            ) =>
              intent !==
              "general",
          )
          .map(
            (
              intent,
            ) => {

              const attribute =
                getPrimaryAttributeForIntent(
                  intent,
                  query,
                );

              return [
                `${intent}:${attribute}`,

                {
                  intent,

                  attribute,
                },
              ];
            },
          ),
      ).values(),
    ];


  const covered =
    requested.filter(
      (
        requirement,
      ) =>
        selected.some(
          (
            item,
          ) =>
            supportsRequestedAttribute(
              item,
              requirement,
              entityTerms,
              query,
            ),
        ),
    );


  const missing =
    requested.filter(
      (
        requirement,
      ) =>
        !covered.some(
          (
            coveredRequirement,
          ) =>
            coveredRequirement.intent ===
              requirement.intent &&

            coveredRequirement.attribute ===
              requirement.attribute,
        ),
    );


  return {
    requested,
    covered,
    missing,
  };
}

function buildNormalEligibilityPathDiagnostics(
  item: RankedKnowledgeItem,
  intents: KnowledgeIntent[],
  tenantWideServiceQuery: boolean,
): KnowledgeSelectionCandidateDiagnostic["eligibilityPaths"] {
  const supportingEvidence = hasSupportingEvidence(item);
  const facilityIntent = intents.includes("facilities");
  const paths = [
    {
      path: "tenant_wide_service",
      gates: {
        tenantWideServiceQuery,
        serviceIntentEvidence: intents.includes("services") && item.intentMatch,
        explicitServiceOfferingEvidence: hasExplicitServiceOfferingEvidence(item),
        vectorScore: item.score >= 0.55,
        rerankerScore: item.rerankScore >= 0.72,
        supportingEvidence,
      },
    },
    {
      path: "entity_specific",
      gates: {
        entityMatch: item.entityMatch,
        vectorScore: item.score >= 0.55,
        rerankerScore: item.rerankScore >= 0.72,
        supportingEvidence,
      },
    },
    {
      path: "facilities_rescue",
      gates: {
        facilityIntent,
        vectorScore: item.score >= 0.55,
        rerankerScore: item.rerankScore >= 0.68,
        supportingEvidence,
      },
    },
    {
      path: "normal_threshold",
      gates: {
        vectorScore: item.score >= NORMAL_VECTOR_THRESHOLD,
        rerankerScore: item.rerankScore >= NORMAL_RERANK_THRESHOLD,
      },
    },
    {
      path: "exact_phrase_rescue",
      gates: {
        exactPhraseMatch: item.exactPhraseMatch,
        vectorScore: item.score >= EXACT_PHRASE_VECTOR_THRESHOLD,
        rerankerScore: item.rerankScore >= EXACT_PHRASE_RERANK_THRESHOLD,
      },
    },
    {
      path: "semantic_rescue",
      gates: {
        vectorScore: item.score >= SEMANTIC_RESCUE_VECTOR_THRESHOLD,
        rerankerScore: item.rerankScore >= SEMANTIC_RESCUE_RERANK_THRESHOLD,
      },
    },
    {
      path: "supported_rescue",
      gates: {
        vectorScore: item.score >= SUPPORTED_RESCUE_VECTOR_THRESHOLD,
        rerankerScore: item.rerankScore >= SUPPORTED_RESCUE_RERANK_THRESHOLD,
        supportingEvidence,
      },
    },
  ];

  return paths.map(({ path, gates }) => {
    const failedGates = Object.entries(gates)
      .filter(([, passed]) => !passed)
      .map(([gate]) => gate);
    return {
      path,
      passed: failedGates.length === 0,
      failedGates,
    };
  });
}

/*
 * --------------------------------------------------
 * Final knowledge selection
 * --------------------------------------------------
 *
 * Important:
 *
 * We do NOT require:
 *
 *   matchedTerms > 0
 *
 * for every ordinary business question.
 *
 * A strong semantic result may qualify by itself.
 *
 * Entity-aware matching is additionally used when the
 * customer identifies a specific business entity.
 * --------------------------------------------------
 */



export function selectKnowledgeForAnswer(

  question:
    string,

  knowledge:
    KnowledgeContextItem[],

  analysisQuestion:
    string =
      question,

  workerVersion?: WorkerVersionIdentity,
):

  {

    analysis:
      KnowledgeQueryAnalysis;

    ranked:
      RankedKnowledgeItem[];

    selected:
      RankedKnowledgeItem[];

      answerable:
      boolean;
    intentCoverage: {
      covered:
        KnowledgeIntent[];

      missing:
        KnowledgeIntent[];
    };

    attributeCoverage:
       KnowledgeAttributeCoverage;

    candidateDiagnostics:
      KnowledgeSelectionCandidateDiagnostic[];
  }
  {



  /*
   * ------------------------------------------------
   * Analyze the customer's current message
   * separately from the retrieval query.
   * ------------------------------------------------
   *
   * Current-message analysis controls:
   *
   * - intent
   * - language
   * - high-risk classification
   * - business-evidence requirement
   *
   * Retrieval analysis controls:
   *
   * - retrieval terms
   * - focus phrases
   * - lexical overlap
   * - intent evidence against retrieved content
   * ------------------------------------------------
   */

  const analysis =
    analyzeKnowledgeQuery(
      analysisQuestion,
    );

  const ranked =
    rerankKnowledge(
      question,
      knowledge,
      analysisQuestion,
    );

  /*
   * ------------------------------------------------
   * If the customer identified a specific entity and
   * at least one sufficiently relevant entity-specific
   * source exists, generic fallback sources must not
   * be selected instead.
   * ------------------------------------------------
   */

  const entityCandidateExists =
    hasStrongEntityCandidate(
      ranked,
    );

  const retrievalAnalysis = analyzeKnowledgeQuery(question);
  const entityTerms = extractQueryEntityTerms(
    question,
    retrievalAnalysis,
    analysisQuestion,
    analysis,
  );
  const attributeEntityTerms = extractEntityTerms(
    analysisQuestion,
    analysis.intents,
  );
  const normalEligibilityPaths = new Map(
    ranked.map((item) => [
      item,
      buildNormalEligibilityPathDiagnostics(
        item,
        analysis.intents,
        analysis.intents.includes("services") && entityTerms.length === 0,
      ),
    ]),
  );

  const hasMismatchedBranchServiceEntity = (
    item: RankedKnowledgeItem,
  ): boolean => {
    if (
      !analysis.intents.includes("services") ||
      entityTerms.length === 0 ||
      item.entityMatch ||
      item.fallbackLike ||
      !/\b(?:branch|outlet|location)\b/i.test(item.title)
    ) {
      return false;
    }

    const documentEntityTerms = extractEntityTerms(
      `${item.title} ${item.content}`,
      analysis.intents,
    );
    return documentEntityTerms.length > 0 &&
      !documentEntityTerms.some((term) => entityTerms.includes(term));
  };

  /*
   * ------------------------------------------------
   * Eligibility
   * ------------------------------------------------
   */


  const eligibilityRejectionReasons =
    new Map<RankedKnowledgeItem, string>();

  const rejectCandidate = (
    item: RankedKnowledgeItem,
    reason: string,
  ): false => {
    eligibilityRejectionReasons.set(item, reason);
    return false;
  };


  const eligible =
    ranked.filter(
      (
        item,
      ) => {

        /*
         * ----------------------------------------
         * Empty / invalid source
         * ----------------------------------------
         */

        if (
          !item.content
            .trim()
            .length
        ) {
          return rejectCandidate(
            item,
            "empty_content",
          );
        }

        if (hasMismatchedBranchServiceEntity(item)) {
          return rejectCandidate(item, "different_branch_entity");
        }

        /*
         * ----------------------------------------
         * Entity-specific source protection
         * ----------------------------------------
         */

        if (
            entityCandidateExists &&
            item.fallbackLike &&
            !item.entityMatch
          ) {
            return rejectCandidate(
              item,
              "entity_specific_source_preferred",
            );
          }

                /*
         * ----------------------------------------
         * Lexical-only candidate eligibility
         * ----------------------------------------
         */

        if (
          item.retrievalMethod === "lexical"
        ) {
          const lexicalRank =
            item.lexicalRank ??
            Number.MAX_SAFE_INTEGER;

          const hasDirectLexicalEvidence =
            lexicalRank <= 5 &&
            hasSupportingEvidence(item) &&
            (
              item.entityMatch ||
              item.titleMatch ||
              item.intentMatch ||
              item.focusPhraseMatch ||
              item.exactPhraseMatch
            );

          if (analysis.highRisk) {
            if (
              lexicalRank <= 2 &&
              item.exactPhraseMatch &&
              item.intentMatch &&
              hasSupportingEvidence(item)
            ) {
              return true;
            }

            return rejectCandidate(
              item,
              "high_risk_lexical_match_requires_exact_evidence",
            );
          }

          if (
            hasDirectLexicalEvidence &&
            item.rerankScore >= 0.55
          ) {
            return true;
          }

          return rejectCandidate(
            item,
            "lexical_evidence_not_strong_enough",
          );
        }

        /*
         * ----------------------------------------
         * High-risk business facts
         * ----------------------------------------
         */

        if (
          analysis.highRisk
        ) {

          /*
           * Exact approved question/content match.
           */

          if (
            item.exactPhraseMatch &&
            item.score >=
              EXACT_PHRASE_VECTOR_THRESHOLD &&
            item.rerankScore >=
              EXACT_PHRASE_RERANK_THRESHOLD
          ) {
            return true;
          }

          /*
           * Strong high-risk match.
           */

          if (
            item.score >=
              HIGH_RISK_VECTOR_THRESHOLD &&
            item.rerankScore >=
              HIGH_RISK_RERANK_THRESHOLD &&
            item.intentMatch &&
            (
              analysis.focusPhrases.length ===
                0 ||
              item.focusPhraseMatch
            )
          ) {
            return true;
          }

          /*
           * Entity-specific high-risk rescue.
           */

          if (
            item.entityMatch &&
            item.score >=
              0.64 &&
            item.rerankScore >=
              0.76 &&
            item.intentMatch
          ) {
            return true;
          }

          /*
           * Supported high-risk rescue.
           */

          const highRiskFallbackEligible =
            item.score >= 0.70 &&
            item.rerankScore >= 0.84 &&
            hasSupportingEvidence(item) &&
            item.intentMatch;

          if (!highRiskFallbackEligible) {
            return rejectCandidate(
              item,
              "high_risk_eligibility_rules_not_satisfied",
            );
          }

          return true;
        }

        /*
         * ----------------------------------------
         * Normal business questions
         * ----------------------------------------
         */

        /*
         * Entity-specific normal match.
         */

        if (
          item.entityMatch &&
          item.score >=
            0.55 &&
          item.rerankScore >=
            0.72 &&

          hasSupportingEvidence(
            item,
          )
        ) {
          return true;
        }

        if (normalEligibilityPaths.get(item)?.find(
          (path) => path.path === "tenant_wide_service",
        )?.passed) {
          return true;
        }

        /*
         * Facilities / amenity rescue.
         *
         * Facility FAQs are ordinary business knowledge,
         * not appointment availability. Keep a slightly
         * lower threshold because short FAQ entries can
         * have modest vector similarity while still
         * containing direct facility evidence.
         */

        if (
            normalEligibilityPaths.get(item)?.find(
              (path) => path.path === "facilities_rescue",
            )?.passed
          ) {
            return true;
          }



        /*

         * Strong normal match.

         */



        if (normalEligibilityPaths.get(item)?.find(
          (path) => path.path === "normal_threshold",
        )?.passed) {



          return true;

        }



        /*

         * Exact phrase rescue.

         */



        if (normalEligibilityPaths.get(item)?.find(
          (path) => path.path === "exact_phrase_rescue",
        )?.passed) {



          return true;

        }



        /*

         * Strong semantic rescue.

         */



        if (normalEligibilityPaths.get(item)?.find(
          (path) => path.path === "semantic_rescue",
        )?.passed) {



          return true;

        }

        /*
         * Supported weaker rescue.
         */

        if (normalEligibilityPaths.get(item)?.find(
          (path) => path.path === "supported_rescue",
        )?.passed) {
          return true;
        }

         return rejectCandidate(
          item,
          "normal_eligibility_rules_not_satisfied",
        );
      },
    );

  /*
   * ------------------------------------------------
   * Source diversity
   * ------------------------------------------------
   *
   * Do not allow one document/source to consume
   * all six knowledge slots.
   * ------------------------------------------------
   */

  const sourceCounts =
    new Map<
      string,
      number
    >();

  const selected:
    RankedKnowledgeItem[] =
    [];

  const selectedDocumentKeys =
  new Set<string>();

/*
 * --------------------------------------------------
 * Intent coverage pass
 * --------------------------------------------------
 *
 * For a compound question, make sure we attempt to
 * include at least one approved knowledge item for
 * every detected business intent before filling the
 * remaining context slots.
 *
 * Example:
 *
 * "What is the check-out time and is there any charge?"
 *
 * intents:
 *   hours
 *   price
 *
 * The selection pass should attempt to include:
 *
 *   one hours source
 *   one price source
 *
 * before adding additional context.
 * --------------------------------------------------
 */

for (
  const requestedIntent of
    analysis.intents
) {

  if (
    requestedIntent ===
    "general"
  ) {

    continue;
  }

  if (
    selected.length >=
    MAX_SELECTED_RESULTS
  ) {

    break;
  }


  const candidate =
  eligible.find(
    (
      item,
    ) => {

      const documentKey =
        getKnowledgeDocumentKey(
          item,
        );


      return (
        !selectedDocumentKeys.has(
          documentKey,
        ) &&

        supportsRequestedIntent(
          item,
          requestedIntent,
        )
      );
    },
  );


  if (
    !candidate
  ) {
    continue;
  }


  const sourceKey =
    [
      candidate.sourceType
        ?.trim()
        .toLowerCase() ??
        "",

      candidate.title
        ?.trim()
        .toLowerCase() ??
        "",
    ].join(
      "|",
    );


  const currentCount =
    sourceCounts.get(
      sourceKey,
    ) ??
    0;


  if (
    currentCount >=
    MAX_RESULTS_PER_SOURCE
  ) {

    continue;
  }


  selected.push(
    candidate,
  );

  selectedDocumentKeys.add(
    getKnowledgeDocumentKey(
      candidate,
    ),
  );


  sourceCounts.set(
      sourceKey,
      currentCount + 1,
    );
  }


for (
  const item of
    eligible
) {



    if (
      selected.length >=
      MAX_SELECTED_RESULTS
    ) {
      break;
    }

    const documentKey =
  getKnowledgeDocumentKey(
    item,
  );


if (
  selectedDocumentKeys.has(
    documentKey,
  )
) {

  continue;
}

    const sourceKey =
      [
        item.sourceType
          ?.trim()
          .toLowerCase() ??
          "",

        item.title
          ?.trim()
          .toLowerCase() ??
          "",
      ].join(
        "|",
      );

    const currentCount =
      sourceCounts.get(
        sourceKey,
      ) ??
      0;

    if (
      currentCount >=
      MAX_RESULTS_PER_SOURCE
    ) {

      continue;

    }

    selected.push(
      item,
    );

    selectedDocumentKeys.add(
      documentKey,
    );

    sourceCounts.set(
      sourceKey,
      currentCount + 1,
    );
  }

  /*

   * ------------------------------------------------

   * Fallback fill

   * ------------------------------------------------

   *

   * If fewer than six results are available after

   * the diversity cap, use remaining eligible results.

   *

   * This prevents one-source knowledge bases from

   * returning too little approved context.

   * ------------------------------------------------

   */



  if (

    selected.length <

    MAX_SELECTED_RESULTS

  ) {
    for (
      const item of
        eligible
    ) {

      if (
        selected.length >=
        MAX_SELECTED_RESULTS

      ) {
        break;
      }

      const documentKey =
        getKnowledgeDocumentKey(
          item,
        );


      if (
        selectedDocumentKeys.has(
          documentKey,
        )
      ) {

        continue;
      }

      const sourceKey =
        [
          item.sourceType
            ?.trim()
            .toLowerCase() ??
            "",

          item.title
            ?.trim()
            .toLowerCase() ??
            "",
        ].join(
          "|",
        );

      const currentCount =
        sourceCounts.get(
          sourceKey,
        ) ??
        0;

      if (
        currentCount >=
        MAX_RESULTS_PER_SOURCE
      ) {
        continue;
      }
      selected.push(
        item,
      );

      selectedDocumentKeys.add(
        documentKey,
      );
      sourceCounts.set(
        sourceKey,
        currentCount + 1,
      );
    }
  }

  const intentCoverage =
  getKnowledgeIntentCoverage(
    analysis.intents,
    selected,
      );

  const requestedAttributeQuery =
    [question, analysisQuestion].join(" ");

  const attributeCoverage =
    getKnowledgeAttributeCoverage(
      analysis.intents,
      attributeEntityTerms,
      selected,
      requestedAttributeQuery,
    );

  console.log(
  "AI KNOWLEDGE INTENT COVERAGE",
  {
    intents:
      analysis.intents,

    covered:
      intentCoverage.covered,

    missing:
      intentCoverage.missing,

    selectedCount:
      selected.length,
  },
);

console.log(
  "AI KNOWLEDGE ATTRIBUTE COVERAGE",
  {
    requested:
      attributeCoverage.requested,

    covered:
      attributeCoverage.covered,

    missing:
      attributeCoverage.missing,

    selectedCount:
      selected.length,
  },
);


  const eligibleSet = new Set(eligible);
  const selectedSet = new Set(selected);

  const candidateDiagnostics:
  KnowledgeSelectionCandidateDiagnostic[] =
  ranked.map((item, index) => ({
    rank: index + 1,
    title: item.title?.trim() || "(untitled)",
    sourceType: item.sourceType || "unknown",

    sourceKey:
      item.providerDocumentId?.trim() ||
      item.knowledgeSourceId?.trim() ||
      null,

    chunkId: item.id?.trim() || null,
    knowledgeSourceId:
      item.knowledgeSourceId?.trim() || null,
    providerDocumentId:
      item.providerDocumentId?.trim() || null,

    chunkIndex: item.chunkIndex ?? null,
    retrievalMethod: item.retrievalMethod ?? "unknown",

    rrfScore:
      typeof item.rrfScore === "number" &&
      Number.isFinite(item.rrfScore)
        ? Number(item.rrfScore.toFixed(6))
        : null,

    vectorRank: item.vectorRank ?? null,
    lexicalRank: item.lexicalRank ?? null,

    lexicalScore:
      typeof item.lexicalScore === "number" &&
      Number.isFinite(item.lexicalScore)
        ? Number(item.lexicalScore.toFixed(4))
        : null,

    score: Number(item.score.toFixed(4)),
    rerankScore: Number(item.rerankScore.toFixed(4)),

    rerankerScore:
      typeof item.rerankerScore === "number" &&
      Number.isFinite(item.rerankerScore)
        ? Number(item.rerankerScore.toFixed(6))
        : null,

    rerankerRank: item.rerankerRank ?? null,

    entityMatch: item.entityMatch,
    fallbackLike: item.fallbackLike,
    intentMatch: item.intentMatch,
    focusPhraseMatch: item.focusPhraseMatch,
    exactPhraseMatch: item.exactPhraseMatch,
    matchedTerms: item.matchedTerms.slice(0, 8),
    entityTermCount: item.entityTermCount,
    entityTokenOverlapCount: item.entityTermMatches.length,
    requestedAttributeSupport: analysis.intents
      .filter((intent) => intent !== "general")
      .map((intent) => {
        const requirement = {
          intent,
          attribute: getPrimaryAttributeForIntent(intent, requestedAttributeQuery),
        };
        const attributeEvidence = hasRequestedAttributeEvidence(
          item,
          requirement,
          requestedAttributeQuery,
        );
        const entityEvidence = attributeEntityTerms.length === 0 || item.entityMatch;
        return {
          ...requirement,
          attributeEvidence,
          entityEvidence,
          supported: supportsRequestedAttribute(
            item,
            requirement,
            attributeEntityTerms,
            requestedAttributeQuery,
          ),
        };
      }),
    eligibilityPaths:
      !analysis.highRisk && item.retrievalMethod !== "lexical"
        ? normalEligibilityPaths.get(item) ?? []
        : [],

    decision: selectedSet.has(item)
      ? "selected"
      : eligibleSet.has(item)
        ? "eligible_not_selected"
        : "rejected",

    rejectionReason:
      eligibilityRejectionReasons.get(item) ?? null,
  }));

  console.log(
    "AI KNOWLEDGE SELECTION DIAGNOSTICS",
    {
      ...(workerVersion ?? {}),
      intent: analysis.intent,
      intents: analysis.intents,
      highRisk: analysis.highRisk,
      focusPhraseCount: analysis.focusPhrases.length,

      retrievedCount: knowledge.length,
      candidateCount: ranked.length,
      eligibleCount: eligible.length,
      selectedCount: selected.length,
      rejectedCount: candidateDiagnostics.filter(
        (item) => item.decision === "rejected",
      ).length,
      entityTermCount: entityTerms.length,
      requestedAttributesSupportedBySelectedEvidence:
        attributeCoverage.missing.length === 0,

      selectedSourceKeys: selected
        .map(
          (item) =>
            item.providerDocumentId?.trim() ||
            item.knowledgeSourceId?.trim(),
        )
        .filter((key): key is string => Boolean(key)),

      candidates: ranked.slice(0, 10).map(
        (item, index) => ({
          rank: index + 1,
          sourceType: item.sourceType,

          sourceKey:
            item.providerDocumentId?.trim() ||
            item.knowledgeSourceId?.trim() ||
            null,
          chunkId: item.id?.trim() || null,
          knowledgeSourceId: item.knowledgeSourceId?.trim() || null,
          providerDocumentId: item.providerDocumentId?.trim() || null,
          chunkIndex: item.chunkIndex ?? null,

          retrievalMethod:
            item.retrievalMethod ?? "unknown",

          rrfScore:
            typeof item.rrfScore === "number"
              ? Number(item.rrfScore.toFixed(6))
              : null,

          vectorRank:
            item.vectorRank ?? null,

          lexicalRank:
            item.lexicalRank ?? null,

          lexicalScore:
            typeof item.lexicalScore === "number"
              ? Number(item.lexicalScore.toFixed(4))
              : null,

          score: Number(item.score.toFixed(4)),
          rerankScore: Number(
            item.rerankScore.toFixed(4),
          ),

          rerankerScore:
            typeof item.rerankerScore === "number" &&
            Number.isFinite(item.rerankerScore)
              ? Number(item.rerankerScore.toFixed(6))
              : null,

          rerankerRank:
            item.rerankerRank ?? null,

          entityMatch: item.entityMatch,
          entityTermCount: item.entityTermCount,
          entityTitleOverlapCount: item.entityTitleOverlapCount,
          entityContentOverlapCount: item.entityContentOverlapCount,
          fallbackLike: item.fallbackLike,
          intentMatch: item.intentMatch,
          focusPhraseMatch: item.focusPhraseMatch,
          exactPhraseMatch: item.exactPhraseMatch,
          matchedTermCount: item.matchedTerms.length,
          requestedAttributeSupport:
            candidateDiagnostics[index]?.requestedAttributeSupport ?? [],
          eligibilityPaths:
            candidateDiagnostics[index]?.eligibilityPaths ?? [],

          decision: selectedSet.has(item)
            ? "selected"
            : eligibleSet.has(item)
              ? "eligible_not_selected"
              : "rejected",

          rejectionReason:
            eligibilityRejectionReasons.get(item) ??
            null,
        }),
      ),
    },
  );

        return {
          analysis,
          ranked,
          selected,
          candidateDiagnostics,

          answerable: selected.length > 0,
          intentCoverage,
          attributeCoverage,
        };
  }

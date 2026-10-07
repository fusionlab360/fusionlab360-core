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

  title:

    string;



  sourceType:

    string;



  content:

    string;



  score:

    number;

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

  intent:

    KnowledgeIntent;



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



  fallbackLike:

    boolean;

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

      "provide",

      "provides",

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

      "ringgit",

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



/*

 * --------------------------------------------------

 * Extract meaningful terms

 * --------------------------------------------------

 */



function extractTerms(

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



  return [

    ...new Set(

      normalized

        .split(

          /\s+/u,

        )

        .map(

          (

            token,

          ) =>

            token.trim(),

        )

        .filter(

          (

            token,

          ) =>

            token.length >=

              3 &&

            !STOP_WORDS.has(

              token,

            ) &&

            !/^\d+$/u.test(

              token,

            ),

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

    KnowledgeIntent,

):

  string[] {



  const terms =

    extractTerms(

      value,

    );



  const attributes =

    ATTRIBUTE_TERMS_BY_INTENT[

      intent

    ] ?? new Set<string>();



  return terms.filter(

    (

      term,

    ) =>

      !attributes.has(

        term,

      ),

  );

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

    /^(hi|hello|hey|hai|helo)\b/i.test(

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

   * Promotion

   */

  if (

    /\b(promotion|promotions|promo|promosi|offer|offers|special offer|deal|deals|voucher|coupon)\b/i.test(

      normalized,

    )

  ) {

    return "promotion";

  }



  /*

   * Price

   */

  if (

    /\b(price|prices|cost|costs|fee|fees|rate|rates|pricing|harga|kos|yuran|bayaran)\b/i.test(

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

   * Hours

   */

  if (

    /\b(open|opening|closing|hours|operating|waktu|buka|tutup)\b/i.test(

      normalized,

    ) ||

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

      ];



    case "price":

      return [

        "price",

        "prices",

        "cost",

        "fee",

        "fees",

        "rate",

        "pricing",

        "harga",

        "rm",

        "myr",

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



  const intent =

    detectIntent(

      question,

    );



  return {

    intent,



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

      isHighRiskIntent(

        intent,

      ),



    requiresBusinessEvidence:

      requiresBusinessEvidence(

        intent,

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



    const retrievalEntityTerms =
      extractEntityTerms(
        question,
        retrievalAnalysis.intent,
      );

    const currentEntityTerms =
      extractEntityTerms(
        analysisQuestion,
        analysis.intent,
      );

    const entityTerms =
      [
        ...new Set(
          [
            ...retrievalEntityTerms,
            ...currentEntityTerms,
          ],
        ),
      ];



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

          hasIntentEvidence(

            analysis.intent,

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

         * Entity title match.

         *

         * Stronger than ordinary title matching.

         */

        if (
            entityContentOverlap.ratio > 0
          ) {
            rerankScore +=
              entityContentOverlap.ratio *
              ENTITY_CONTENT_BOOST;
          }



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

        if (

          focusPhraseMatch

        ) {



          rerankScore +=

            0.12;



          if (

            matchedFocusPhrases.length >=

            2

          ) {



            rerankScore +=

              0.05;

          }

        }



        /*

         * Exact question match.

         */

        if (

          exactPhraseMatch

        ) {



          rerankScore +=

            0.12;

        }



        /*

         * Intent evidence.

         */

        if (

          intentMatch

        ) {



          rerankScore +=

            0.08;

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



          matchedTerms:

            contentOverlap.matched,



          matchedFocusPhrases,



          titleMatch:

            titleOverlap.ratio >

            0,



          intentMatch,



          focusPhraseMatch,



          exactPhraseMatch,



          entityMatch,



          entityTermMatches,



          fallbackLike,

        };

      },

    )

    .sort(

      (

        a,

        b,

      ) => {



        /*

         * Primary sort:

         * rerank score.

         */

        if (

          b.rerankScore !==

          a.rerankScore

        ) {

          return (

            b.rerankScore -

            a.rerankScore

          );

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

    (

      item,

    ) =>

      item.entityMatch &&

      item.rerankScore >=

        0.68 &&

      item.score >=

        0.55,

  );

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

  } {



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



  /*

   * ------------------------------------------------

   * Eligibility

   * ------------------------------------------------

   */



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



          return false;

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



          return false;

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



          return (

            item.score >=

              0.70 &&



            item.rerankScore >=

              0.84 &&



            hasSupportingEvidence(

              item,

            ) &&



            item.intentMatch

          );

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

            0.58 &&



          item.rerankScore >=

            0.72 &&



          hasSupportingEvidence(

            item,

          )

        ) {



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

          analysis.intent ===

            "facilities" &&



          item.score >=

            0.55 &&



          item.rerankScore >=

            0.68 &&



          hasSupportingEvidence(

            item,

          )

        ) {



          return true;

        }



        /*

         * Strong normal match.

         */



        if (

          item.score >=

            NORMAL_VECTOR_THRESHOLD &&



          item.rerankScore >=

            NORMAL_RERANK_THRESHOLD

        ) {



          return true;

        }



        /*

         * Exact phrase rescue.

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

         * Strong semantic rescue.

         */



        if (

          item.score >=

            SEMANTIC_RESCUE_VECTOR_THRESHOLD &&



          item.rerankScore >=

            SEMANTIC_RESCUE_RERANK_THRESHOLD

        ) {



          return true;

        }



        /*

         * Supported weaker rescue.

         */



        if (

          item.score >=

            SUPPORTED_RESCUE_VECTOR_THRESHOLD &&



          item.rerankScore >=

            SUPPORTED_RESCUE_RERANK_THRESHOLD &&



          hasSupportingEvidence(

            item,

          )

        ) {



          return true;

        }



        return false;

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

      if (
        selected.includes(
          item,
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
      sourceCounts.set(
        sourceKey,
        currentCount + 1,
      );
    }
  }

  return {
    analysis,
    ranked,
    selected,
    answerable:
      selected.length >
      0,
  };
}
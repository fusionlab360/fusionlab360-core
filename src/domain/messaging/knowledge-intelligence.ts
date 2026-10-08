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

    /\b(address|location|branch|branches)\b/i,

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



    const retrievalEntityTerms =
      extractEntityTerms(
        question,
        retrievalAnalysis.intents,
      );


    const currentEntityTerms =
      extractEntityTerms(
        analysisQuestion,
        analysis.intents,
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
  )
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
      return "location";

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

      return hasIntentEvidence(
        "location",
        combined,
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
):
  boolean {

  if (
    !hasRequestedAttributeEvidence(
      item,
      requirement,
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
    intentCoverage: {
      covered:
        KnowledgeIntent[];

      missing:
        KnowledgeIntent[];
    };

    attributeCoverage:
       KnowledgeAttributeCoverage;
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

            0.55 &&



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
            analysis.intents.includes(
              "facilities",
            ) &&

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

  const entityTerms =
  extractEntityTerms(
    analysisQuestion,
    analysis.intents,
  );


  const attributeCoverage =
    getKnowledgeAttributeCoverage(
      analysis.intents,
      entityTerms,
      selected,
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

      return {
        analysis,
        ranked,
        selected,

        answerable:
          selected.length >
          0,

        intentCoverage,

        attributeCoverage,
      };
}
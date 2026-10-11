
export interface EvidenceSource {
  id: string;
  title: string;
  sourceType: string;
  content: string;
}

export interface EvidenceClaim {
  text: string;
  chunk_id: string;
  quote: string;
}

export type EvidenceAnswerStatus =
  | "full"
  | "partial"
  | "none";

export interface EvidenceAnswerResult {
  valid: boolean;
  status: EvidenceAnswerStatus | "invalid";
  answer: string;
  reason: string;
  errors: string[];
  evidenceIds: string[];
}

function normalizeEvidenceText(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function splitAnswerIntoSentences(
  value: string,
): string[] {
  return value
    .split(/(?<=[.!?。！？])\s+|[\r\n]+/u)
    .map((sentence) =>
      sentence
        .trim()
        .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/u, "")
        .trim(),
    )
    .filter(Boolean);
}


function normalizeCriticalFact(value: string): string {
  return value
    .replace(/\bmyr\b/gu, "rm")
    .replace(/[,\s]+/gu, "");
}

function extractCriticalFacts(value: string): string[] {
  const normalized = normalizeEvidenceText(value)
    .replace(/,/gu, "");

  const patterns: RegExp[] = [
    // Monetary amounts, including RM and MYR.
    /\b(?:rm|myr)\s*\d+(?:\.\d{1,2})?\b/gu,

    // Percentages.
    /\b\d+(?:\.\d+)?\s*%/gu,

    // Clock times such as 9 AM or 6:30 PM.
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gu,

    // ISO numeric dates.
    /\b\d{4}-\d{2}-\d{2}\b/gu,

    // Slash-separated numeric dates.
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu,
  ];

  return patterns
    .flatMap((pattern) => normalized.match(pattern) ?? [])
    .map(normalizeCriticalFact);
}


export function buildEvidenceAnswerContract(): string {
  return [
    "STRUCTURED EVIDENCE ANSWER CONTRACT",
    "Return valid JSON only. Do not use Markdown fences or text outside the JSON.",
    'Use this structure: {"status":"full|partial|none","answer":"customer-facing answer","claims":[{"text":"exact sentence from answer","chunk_id":"K1","quote":"exact excerpt from the cited evidence"}]}.',
    "Only use evidence explicitly supplied in the approved knowledge context.",
    "Every factual sentence in the answer must have a corresponding claim.",
    "The claim text must be copied exactly from the customer-facing answer.",
    "Each claim must cite one valid Evidence ID shown in the knowledge context.",
    "Each quote must be a verbatim excerpt from that specific evidence source. Do not rewrite or combine quotes.",
    "Do not cite an evidence source that does not support the claim.",
    "For status full, the approved evidence answers the entire question.",
    "For status partial, the answer contains only supported information and clearly identifies any unresolved part.",
    'For status none, return an empty answer and an empty claims array.',
    "Never invent, infer, or complete missing business facts.",
    "Keep the answer concise, natural, and in the customer's language.",
    "Each claim text must match one complete sentence in the answer, not merely a phrase within a sentence.",
    "Every answer sentence must have a matching evidence claim.",
    "Do not add introductions, conclusions, or other factual statements unless they are supported and represented by claims.",
    "Prices, percentages, stated clock times, and explicit numeric dates in a claim must match the cited quotation after normalizing spaces and thousands separators.",

  ].join("\n");
}

function invalidResult(
  reason: string,
  errors: string[] = [],
): EvidenceAnswerResult {

  return {
  valid: false,
  status: "invalid",
  answer: "",
  reason,
  errors,
  evidenceIds: [],
};
}

export function parseAndVerifyEvidenceAnswer(
  raw: string,
  sources: EvidenceSource[],
): EvidenceAnswerResult {
  const trimmed = raw.trim();

  if (!trimmed) {
    return invalidResult("empty_structured_response");
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (
    firstBrace < 0 ||
    lastBrace <= firstBrace
  ) {
    return invalidResult("missing_json_object");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      withoutFence.slice(firstBrace, lastBrace + 1),
    );
  } catch {
    return invalidResult("invalid_json");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return invalidResult("invalid_json_object");
  }

  const value = parsed as Record<string, unknown>;
  const status = value.status;
  const answer =
    typeof value.answer === "string"
      ? value.answer.trim()
      : "";
  const claims = value.claims;

  if (
    status !== "full" &&
    status !== "partial" &&
    status !== "none"
  ) {
    return invalidResult("invalid_answer_status");
  }

  if (!Array.isArray(claims)) {
    return invalidResult("claims_must_be_an_array");
  }

  if (status === "none") {
    if (answer || claims.length > 0) {
      return invalidResult(
        "none_status_must_not_contain_an_answer_or_claims",
      );
    }

    return {
      valid: true,
      status: "none",
      answer: "",
      reason: "no_supported_evidence",
      errors: [],
      evidenceIds: [],
    };
  }

  if (!answer) {
    return invalidResult("empty_answer");
  }

  if (claims.length === 0) {
    return invalidResult("answer_has_no_evidence_claims");
  }

  const sourceById = new Map(
    sources.map((source) => [source.id, source]),
  );

  const normalizedAnswer =
    normalizeEvidenceText(answer);

  const answerSentences = splitAnswerIntoSentences(answer)
  .map(normalizeEvidenceText);

  const claimedSentences = new Set<string>();

  const errors: string[] = [];

  const verifiedEvidenceIds = new Set<string>();


  for (const [index, rawClaim] of claims.entries()) {
    if (
      typeof rawClaim !== "object" ||
      rawClaim === null ||
      Array.isArray(rawClaim)
    ) {
      errors.push(`claim_${index + 1}_invalid_object`);
      continue;
    }

    const claim =
      rawClaim as Record<string, unknown>;

    const claimText =
      typeof claim.text === "string"
        ? claim.text.trim()
        : "";

    const chunkId =
      typeof claim.chunk_id === "string"
        ? claim.chunk_id.trim()
        : "";

    const quote =
      typeof claim.quote === "string"
        ? claim.quote.trim()
        : "";

    if (!claimText || !chunkId || !quote) {
      errors.push(`claim_${index + 1}_missing_fields`);
      continue;
    }

    const source = sourceById.get(chunkId);

    if (!source) {
      errors.push(
        `claim_${index + 1}_unknown_evidence_id`,
      );
      continue;
    }

    verifiedEvidenceIds.add(chunkId);

   const normalizedClaimText =
    normalizeEvidenceText(claimText);

    if (!answerSentences.includes(normalizedClaimText)) {
      errors.push(
        `claim_${index + 1}_text_not_exact_answer_sentence`,
      );
    } else {
      claimedSentences.add(normalizedClaimText);
    }

      // Verify that the quotation exists in the cited source.
    if (
      !normalizeEvidenceText(source.content).includes(
        normalizeEvidenceText(quote),
      )
    ) {
      errors.push(
        `claim_${index + 1}_quote_not_found_in_source`,
      );
    }

    const claimCriticalFacts =
      extractCriticalFacts(claimText);

    const quoteCriticalFacts = new Set(
      extractCriticalFacts(quote),
    );

    if (
      claimCriticalFacts.some(
        (fact) => !quoteCriticalFacts.has(fact),
      )
    ) {
      errors.push(
        `claim_${index + 1}_critical_fact_not_in_quote`,
      );
    }

  }

    // Reject answer sentences that have no validated claim.
  for (
    const [sentenceIndex, sentence]
    of answerSentences.entries()
  ) {
    if (!claimedSentences.has(sentence)) {
      errors.push(
        `answer_sentence_${sentenceIndex + 1}_missing_claim`,
      );
    }
  }

  if (errors.length > 0) {
    return invalidResult(
      "evidence_claim_verification_failed",
      errors,
    );
  }

  return {
    valid: true,
    status,
    answer,
    reason: "evidence_quotes_verified",
    errors: [],
    evidenceIds: [...verifiedEvidenceIds],
  };
}
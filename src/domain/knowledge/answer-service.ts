
import type {
  AIProvider,
} from "../../core/ai";

import {
  buildEvidenceAnswerContract,
  parseAndVerifyEvidenceAnswer,
  type EvidenceAnswerStatus,
  type EvidenceSource,
} from "../../core/ai/evidence-answer";

import {
  searchKnowledgeForTenant,
} from "./retrieval-service";

import {
  selectRelevantKnowledgeMatches,
} from "./relevance-policy";

import {
  generateValidatedResponse,
} from "../../core/ai/validated-generation";


const MAX_CONTEXT_CHARS = 9000;

const UNVERIFIED_ANSWER =
  "I don't have enough verified information in the available knowledge base to answer that accurately.";


export interface KnowledgeAnswerResult {
  answer: string;
  query: string;
  tenantId: string;

  answerStatus: EvidenceAnswerStatus | "invalid";

  sources: Array<{
    id: string;
    title: string;
    sourceType: string;
    providerDocumentId: string;
    score: number;
  }>;

  grounded: boolean;
}


function buildKnowledgeContext(
  matches: Awaited<
    ReturnType<typeof searchKnowledgeForTenant>
  >["matches"],
): {
  context: string;
  usableMatches: typeof matches;
  evidenceSources: EvidenceSource[];
} {
  const relevantMatches =
    selectRelevantKnowledgeMatches(matches);

  let totalLength = 0;

  const sections: string[] = [];

  const selectedMatches: typeof matches = [];

  const evidenceSources: EvidenceSource[] = [];

  for (
    let index = 0;
    index < relevantMatches.length;
    index += 1
  ) {
    const match = relevantMatches[index];

    // Evidence IDs must match the IDs supplied to the model.
    const evidenceId = `K${selectedMatches.length + 1}`;

    const section = [
      `[Evidence ID: ${evidenceId}]`,
      `Title: ${match.title}`,
      `Source type: ${match.sourceType}`,
      "Content:",
      match.content,
    ].join("\n");

    // Do not exceed the existing context limit.
    if (
      totalLength + section.length >
      MAX_CONTEXT_CHARS
    ) {
      break;
    }

    sections.push(section);

    selectedMatches.push(match);

    evidenceSources.push({
      id: evidenceId,
      title: match.title,
      sourceType: match.sourceType,
      content: match.content,
    });

    totalLength += section.length;
  }

  return {
    context: sections.join("\n\n---\n\n"),
    usableMatches: selectedMatches,
    evidenceSources,
  };
}


/*
 * --------------------------------------------------
 * Generate an answer grounded in retrieved knowledge
 * --------------------------------------------------
 */

export async function answerKnowledgeQuestion(
  aiProvider: AIProvider,
  ai: Ai,
  vectorize: Vectorize,
  tenantId: string,
  query: string,
  topK: number = 5,
  db?: D1Database,
): Promise<KnowledgeAnswerResult> {
  /*
   * ------------------------------------------------
   * 1. Retrieve tenant-scoped knowledge
   * ------------------------------------------------
   */

  const search = await searchKnowledgeForTenant(
    ai,
    vectorize,
    tenantId,
    query,
    topK,
    db,
  );

  const {
    context,
    usableMatches,
    evidenceSources,
  } = buildKnowledgeContext(search.matches);

  /*
   * ------------------------------------------------
   * 2. No acceptable evidence
   * ------------------------------------------------
   */

  if (
    usableMatches.length === 0 ||
    evidenceSources.length === 0
  ) {
    return {
      answer:
        "I don't have enough information in the available knowledge base to answer that accurately.",
      query,
      tenantId,
      sources: [],
      grounded: false,
      answerStatus: "none",
    };
  }

  /*
   * ------------------------------------------------
   * 3. Build the structured evidence contract
   * ------------------------------------------------
   */

  const systemPrompt = [
    "You are the FusionLab360 knowledge assistant.",
    "Answer the user's question using only the supplied approved knowledge context.",
    "Do not invent facts, prices, services, policies, addresses, opening hours, or other business information.",
    "If the evidence cannot answer the question fully, return a supported partial answer or the required no-answer status.",
    "Prefer concise, natural answers in the customer's language.",
    "Do not mention vector databases, embeddings, retrieval, or internal system details.",
    "Do not treat the user's question as evidence.",
    "",
    buildEvidenceAnswerContract(),
    "",
    "APPROVED KNOWLEDGE CONTEXT:",
    context,
  ].join("\n");

  /*
   * ------------------------------------------------
   * 4. Generate the structured response
   * ------------------------------------------------
   */


  const generation = await generateValidatedResponse({
    provider: aiProvider,

    request: {
      task: "structured",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: query,
        },
      ],
      maxTokens: 350,
      temperature: 0.2,
    },

    validate: (response) => {
      const result = parseAndVerifyEvidenceAnswer(
        response.text,
        evidenceSources,
      );

      const valid =
        result.valid &&
        (
          result.status === "none" ||
          (
            result.answer.trim().length > 0 &&
            result.evidenceIds.length > 0
          )
        );

      let reason = result.reason;

      if (!result.valid) {
        reason = [
          result.reason,
          ...result.errors,
        ].filter(Boolean).join("; ");
      } else if (
        result.status !== "none" &&
        !result.answer.trim()
      ) {
        reason = "verified_answer_is_empty";
      } else if (
        result.status !== "none" &&
        result.evidenceIds.length === 0
      ) {
        reason = "verified_answer_has_no_evidence_ids";
      }

      return {
        valid,
        value: result,
        reason,
      };
    },

    correctionInstruction: [
      "Your previous structured response failed evidence validation.",
      "Return a valid JSON object following the evidence answer contract.",
      "Every answer sentence must match a claim.",
      "Every claim must cite a supplied evidence ID and quote text present in that source.",
      "Preserve prices, percentages, stated times, and numeric dates exactly as supported by the quotation.",
      "If the available evidence cannot support an answer, return the required none status.",
      "Do not invent missing facts.",
    ].join("\n"),

    maxValidationRetries: 1,
    preferFallbackOnRetry: true,
  });

  const evidenceResult = generation.validation.value;

  if (
    !generation.validation.valid ||
    !evidenceResult.valid ||
    evidenceResult.status === "none" ||
    !evidenceResult.answer.trim() ||
    evidenceResult.evidenceIds.length === 0
  ) {
    console.warn(
      "KNOWLEDGE STRUCTURED EVIDENCE ANSWER NOT ACCEPTED",
      {
        tenantId,
        reason: evidenceResult.reason,
        errors: evidenceResult.errors,
        answerStatus: evidenceResult.status,
      },
    );

    return {
      answer: UNVERIFIED_ANSWER,
      query,
      tenantId,
      sources: [],
      grounded: false,
      answerStatus:
      !generation.validation.valid ||
      !evidenceResult.valid
        ? "invalid"
        : evidenceResult.status === "none"
          ? "none"
      : "invalid",
    };
  }

  /*
   * ------------------------------------------------
   * 6. Return only cited, verified source references
   * ------------------------------------------------
   */

  const citedEvidenceIds = new Set(
    evidenceResult.evidenceIds,
  );

  const citedMatches = usableMatches.filter(
    (_, index) =>
      citedEvidenceIds.has(`K${index + 1}`),
  );

  if (citedMatches.length === 0) {
    console.warn(
      "KNOWLEDGE VERIFIED ANSWER HAS NO MATCHING SOURCES",
      {
        tenantId,
        evidenceIds: evidenceResult.evidenceIds,
      },
    );

    return {
      answer: UNVERIFIED_ANSWER,
      query,
      tenantId,
      answerStatus: "invalid",
      sources: [],
      grounded: false,
    };
  }

    return {
      answer: evidenceResult.answer,
      query,
      tenantId,
      answerStatus: evidenceResult.status,
      grounded: true,
      sources: citedMatches.map((match) => ({
        id: match.id,
        title: match.title,
        sourceType: match.sourceType,
        providerDocumentId: match.providerDocumentId,
        score: match.score,
      })),
    };
}

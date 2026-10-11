import {
  selectKnowledgeForAnswer,
  type KnowledgeContextItem,
  type KnowledgeSelectionCandidateDiagnostic,
} from "./knowledge-intelligence";


import {
  RETRIEVAL_EVALUATION_CASES,
  type RetrievalEvaluationBenchmarkCase,
} from "./retrieval-evaluation-cases";



export interface EvaluationKnowledgeRetriever {
  search(
    query: string,
    originalQuery?: string,
  ): Promise<KnowledgeContextItem[]>;
}

export interface RetrievalEvaluationRunOptions {
  retriever: EvaluationKnowledgeRetriever;

  /**
   * Map real document/source/chunk IDs to logical benchmark keys.
   *
   * Example:
   * {
   *   "actual-provider-document-id": "services:general"
   * }
   *
   * Never populate this map with guessed IDs.
   */
  sourceKeyById: Readonly<Record<string, string>>;

  cases?: readonly RetrievalEvaluationBenchmarkCase[];
  topK?: number;
}

export interface UnmappedEvidenceDiagnostic {
  title: string;
  sourceType: string;
  id: string | null;
  providerDocumentId: string | null;
  knowledgeSourceId: string | null;
  chunkIndex: number | null;
  score: number | null;
  retrievalMethod: string | null;
}

export interface RetrievalEvaluationCaseResult {
  caseId: string;
  question: string;
  reviewStatus: "draft" | "verified";
  expectedAnswerable: boolean;

  retrievedSourceKeys: string[];
  selectedSourceKeys: string[];

  relevantSourceKeys: string[];
  requiredSourceKeys: string[];
  matchedRelevantSourceKeys: string[];
  matchedRequiredSourceKeys: string[];
  missingRequiredSourceKeys: string[];

  unmappedRetrievedSources:
    UnmappedEvidenceDiagnostic[];

  unmappedSelectedSources:
    UnmappedEvidenceDiagnostic[];

  unmappedRetrievedItems: number;
  unmappedSelectedItems: number;
  candidateDiagnostics:
  KnowledgeSelectionCandidateDiagnostic[];
}

export interface RetrievalOnlyEvaluationSummary {
  casesRun: number;
  verifiedCasesEvaluated: number;
  answerableCasesEvaluated: number;

  recallAtK: number | null;
  meanReciprocalRank: number | null;
  answerableRetrievalHitRate: number | null;
  selectedEvidenceHitRate: number | null;
  requiredEvidenceCompleteRate: number | null;

  unmappedRetrievedItems: number;
  unmappedSelectedItems: number;
}

export interface RetrievalEvaluationRunResult {
  cases: RetrievalEvaluationCaseResult[];

  /**
   * Null means no cases had verified labels.
   * Draft cases are never silently scored.
   */
  summary: RetrievalOnlyEvaluationSummary | null;
}

interface MappedKeys {
  keys: string[];
  unmappedCount: number;
  unmappedItems: UnmappedEvidenceDiagnostic[];
}

/**
 * Resolve an evidence item to one logical evaluation key.
 *
 * Lookup order follows the current source-key convention:
 * provider document ID, knowledge source ID, then chunk ID.
 */
function mapEvidenceKeys(
  items: readonly KnowledgeContextItem[],
  sourceKeyById: Readonly<Record<string, string>>,
): MappedKeys {
  const keys: string[] = [];
  const seen = new Set<string>();
  let unmappedCount = 0;

  const unmappedItems:
    UnmappedEvidenceDiagnostic[] = [];

  for (const item of items) {
    const identifiers = [
      item.providerDocumentId,
      item.knowledgeSourceId,
      item.id,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    let sourceKey: string | undefined;

    for (const identifier of identifiers) {
      const candidate = sourceKeyById[identifier]?.trim();

      if (candidate) {
        sourceKey = candidate;
        break;
      }
    }

    if (!sourceKey) {
        unmappedCount += 1;

        unmappedItems.push({
            title: item.title?.trim() || "(untitled)",
            sourceType: item.sourceType || "unknown",
            id: item.id ?? null,
            providerDocumentId: item.providerDocumentId ?? null,
            knowledgeSourceId: item.knowledgeSourceId ?? null,
            chunkIndex: item.chunkIndex ?? null,
            score: item.score ?? null,
            retrievalMethod: item.retrievalMethod ?? null,
        });

        continue;
        }

    // Score distinct logical sources, not repeated chunks.
    if (!seen.has(sourceKey)) {
      seen.add(sourceKey);
      keys.push(sourceKey);
    }
  }

    return {
    keys,
    unmappedCount,
    unmappedItems,
  };
}

function ratio(
  numerator: number,
  denominator: number,
): number | null {
  return denominator > 0
    ? numerator / denominator
    : null;
}

function summarizeVerifiedCases(
  results: readonly RetrievalEvaluationCaseResult[],
  topK: number,
): RetrievalOnlyEvaluationSummary | null {
  const verified = results.filter(
    (result) => result.reviewStatus === "verified",
  );

  // Never publish scores based entirely on provisional labels.
  if (verified.length === 0) {
    return null;
  }

  const answerable = verified.filter(
    (result) =>
      result.expectedAnswerable &&
      result.relevantSourceKeys.length > 0,
  );

  let recallTotal = 0;
  let reciprocalRankTotal = 0;
  let retrievalHits = 0;
  let selectedHits = 0;
  let completeRequiredEvidence = 0;
  let requiredEvidenceCases = 0;

  for (const result of answerable) {
    const relevant = new Set(result.relevantSourceKeys);
    const topRetrieved = result.retrievedSourceKeys.slice(0, topK);
    const retrievedRelevant = new Set(
      topRetrieved.filter((key) => relevant.has(key)),
    );

    recallTotal +=
      retrievedRelevant.size / relevant.size;

    if (retrievedRelevant.size > 0) {
      retrievalHits += 1;
    }

    const firstRelevantIndex =
      result.retrievedSourceKeys.findIndex(
        (key) => relevant.has(key),
      );

    if (firstRelevantIndex >= 0) {
      reciprocalRankTotal += 1 / (firstRelevantIndex + 1);
    }

    const selected = new Set(result.selectedSourceKeys);

    if ([...relevant].some((key) => selected.has(key))) {
      selectedHits += 1;
    }

    if (result.requiredSourceKeys.length > 0) {
      requiredEvidenceCases += 1;

      if (
        result.requiredSourceKeys.every(
          (key) => selected.has(key),
        )
      ) {
        completeRequiredEvidence += 1;
      }
    }
  }

  return {
    casesRun: results.length,
    verifiedCasesEvaluated: verified.length,
    answerableCasesEvaluated: answerable.length,

    recallAtK: ratio(recallTotal, answerable.length),
    meanReciprocalRank: ratio(
      reciprocalRankTotal,
      answerable.length,
    ),
    answerableRetrievalHitRate: ratio(
      retrievalHits,
      answerable.length,
    ),
    selectedEvidenceHitRate: ratio(
      selectedHits,
      answerable.length,
    ),
    requiredEvidenceCompleteRate: ratio(
      completeRequiredEvidence,
      requiredEvidenceCases,
    ),

    unmappedRetrievedItems: verified.reduce(
      (total, result) => total + result.unmappedRetrievedItems,
      0,
    ),
    unmappedSelectedItems: verified.reduce(
      (total, result) => total + result.unmappedSelectedItems,
      0,
    ),
  };
}

/**
 * Run retrieval and the existing deterministic knowledge-selection
 * logic for each benchmark question.
 *
 * This is not end-to-end response evaluation: it does not call the
 * query-rewrite LLM or generate/verify a customer-facing answer.
 */
export async function runRetrievalEvaluation(
  options: RetrievalEvaluationRunOptions,
): Promise<RetrievalEvaluationRunResult> {
  const cases = options.cases ?? RETRIEVAL_EVALUATION_CASES;

  const topK = Number.isFinite(options.topK)
    ? Math.min(Math.max(Math.floor(options.topK!), 1), 100)
    : 5;

  const results: RetrievalEvaluationCaseResult[] = [];

  for (const testCase of cases) {
    const retrieved = await options.retriever.search(
      testCase.question,
      testCase.question,
    );

    const rankedSources = mapEvidenceKeys(
      retrieved,
      options.sourceKeyById,
    );

    const selection = selectKnowledgeForAnswer(
      testCase.question,
      retrieved,
      testCase.question,
    );

    const selectedSources = mapEvidenceKeys(
      selection.selected,
      options.sourceKeyById,
    );

    const relevantSourceKeys = [
      ...new Set(testCase.relevantSourceKeys),
    ];

    const requiredSourceKeys = [
      ...new Set(testCase.requiredSourceKeys),
    ];

    const selectedSet = new Set(selectedSources.keys);
    const retrievedSet = new Set(rankedSources.keys);

    results.push({
      caseId: testCase.id,
      question: testCase.question,
      reviewStatus: testCase.reviewStatus,
      expectedAnswerable: testCase.expectedAnswerable,

      retrievedSourceKeys: rankedSources.keys,
      selectedSourceKeys: selectedSources.keys,

      relevantSourceKeys,
      requiredSourceKeys,

      matchedRelevantSourceKeys: relevantSourceKeys.filter(
        (key) => retrievedSet.has(key),
      ),
      matchedRequiredSourceKeys: requiredSourceKeys.filter(
        (key) => selectedSet.has(key),
      ),
      missingRequiredSourceKeys: requiredSourceKeys.filter(
        (key) => !selectedSet.has(key),
      ),

      unmappedRetrievedSources:
        rankedSources.unmappedItems,

      unmappedSelectedSources:
        selectedSources.unmappedItems,

      unmappedRetrievedItems: rankedSources.unmappedCount,
      unmappedSelectedItems: selectedSources.unmappedCount,
      candidateDiagnostics: selection.candidateDiagnostics,
    });
  }

  return {
    cases: results,
    summary: summarizeVerifiedCases(results, topK),
  };
}
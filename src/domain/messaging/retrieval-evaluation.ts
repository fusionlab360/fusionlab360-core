export interface RetrievalEvaluationCase {
  id: string;

  // Stable keys identifying the sources that should answer this query.
  relevantSourceKeys: string[];

  // False when the approved knowledge genuinely cannot answer the query.
  expectedAnswerable: boolean;
}

export interface RetrievalEvaluationObservation {
  caseId: string;
  retrievedSourceKeys: string[];
  selectedSourceKeys: string[];
  answerProduced: boolean;
  handedOff: boolean;
  groundingRejected: boolean;
  unsupportedClaimDetected: boolean;
  providerFallbackUsed: boolean;
  latencyMs: number;
}

export interface RetrievalEvaluationSummary {
  casesEvaluated: number;
  recallAtK: number | null;
  meanReciprocalRank: number | null;
 answerableRetrievalHitRate: number | null;
  selectedEvidenceHitRate: number | null;
  groundedAnswerSuccessRate: number | null;
  falseHandoffRate: number | null;
  unanswerableAnswerRate: number | null;
  unsupportedClaimRate: number | null;
  averageLatencyMs: number | null;
  providerFallbackRate: number | null;
  
}

function ratio(
  numerator: number,
  denominator: number,
): number | null {
  return denominator > 0
    ? numerator / denominator
    : null;
}

export function summarizeRetrievalEvaluation(
  cases: RetrievalEvaluationCase[],
  observations: RetrievalEvaluationObservation[],
  k = 5,
): RetrievalEvaluationSummary {
  const safeK = Math.min(
    Math.max(Math.floor(k), 1),
    100,
  );

  const observationByCaseId = new Map(
    observations.map(
      (observation) => [
        observation.caseId,
        observation,
      ],
    ),
  );

  const evaluated = cases
    .map((testCase) => ({
      testCase,
      observation:
        observationByCaseId.get(testCase.id),
    }))
    .filter(
      (
        item,
      ): item is {
        testCase: RetrievalEvaluationCase;
        observation: RetrievalEvaluationObservation;
      } => Boolean(item.observation),
    );

  const answerable = evaluated.filter(
    ({ testCase }) =>
      testCase.expectedAnswerable &&
      testCase.relevantSourceKeys.length > 0,
  );

  let recallTotal = 0;
  let reciprocalRankTotal = 0;
  let retrievalHits = 0;

  const selectedEvidenceHits = answerable.filter(
  ({ testCase, observation }) => {
    const relevant = new Set(testCase.relevantSourceKeys);

    return observation.selectedSourceKeys.some(
      (key) => relevant.has(key),
    );
  },
).length;

const unanswerable = evaluated.filter(
  ({ testCase }) => !testCase.expectedAnswerable,
);

const unanswerableAnswers = unanswerable.filter(
  ({ observation }) => observation.answerProduced,
).length;

  for (const { testCase, observation } of answerable) {
    const relevant = new Set(
      testCase.relevantSourceKeys,
    );

    const topK = observation.retrievedSourceKeys
      .slice(0, safeK);

    const retrievedRelevant = new Set(
      topK.filter((key) => relevant.has(key)),
    );

    recallTotal +=
      retrievedRelevant.size / relevant.size;

    if (retrievedRelevant.size > 0) {
      retrievalHits += 1;
    }

    const firstRelevantIndex =
      observation.retrievedSourceKeys.findIndex(
        (key) => relevant.has(key),
      );

    if (firstRelevantIndex >= 0) {
      reciprocalRankTotal +=
        1 / (firstRelevantIndex + 1);
    }
  }

  const groundedSuccesses = answerable.filter(
    ({ observation }) =>
      observation.answerProduced &&
      !observation.handedOff &&
      !observation.groundingRejected &&
      !observation.unsupportedClaimDetected,
  ).length;

  const falseHandoffs = answerable.filter(
    ({ observation }) => observation.handedOff,
  ).length;

  const unsupportedClaims = evaluated.filter(
    ({ observation }) =>
      observation.unsupportedClaimDetected,
  ).length;

  const fallbackCount = evaluated.filter(
    ({ observation }) =>
      observation.providerFallbackUsed,
  ).length;

  const averageLatency =
    evaluated.length > 0
      ? evaluated.reduce(
          (total, { observation }) =>
            total + Math.max(0, observation.latencyMs),
          0,
        ) / evaluated.length
      : null;

  return {
    casesEvaluated: evaluated.length,

    recallAtK: ratio(
      recallTotal,
      answerable.length,
    ),

    meanReciprocalRank: ratio(
      reciprocalRankTotal,
      answerable.length,
    ),

    answerableRetrievalHitRate: ratio(
      retrievalHits,
      answerable.length,
    ),

    groundedAnswerSuccessRate: ratio(
      groundedSuccesses,
      answerable.length,
    ),

    selectedEvidenceHitRate: ratio(
      selectedEvidenceHits,
      answerable.length,
    ),

    unanswerableAnswerRate: ratio(
      unanswerableAnswers,
      unanswerable.length,
    ),

    falseHandoffRate: ratio(
      falseHandoffs,
      answerable.length,
    ),

    unsupportedClaimRate: ratio(
      unsupportedClaims,
      evaluated.length,
    ),

    averageLatencyMs: averageLatency,

    providerFallbackRate: ratio(
      fallbackCount,
      evaluated.length,
    ),
  };
}
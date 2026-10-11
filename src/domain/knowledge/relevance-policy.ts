
export interface KnowledgeRelevanceCandidate {
  content: string;
  score: number;
  rerankerScore?: number;
}

const MIN_VECTOR_RELEVANCE_SCORE = 0.65;

// Provisional threshold; calibrate with real retrieval evaluations.
const MIN_RERANKER_RELEVANCE_SCORE = 0.5;

function normalizeRerankerScore(score: number): number {
  const boundedScore = Math.max(-60, Math.min(60, score));

  return 1 / (1 + Math.exp(-boundedScore));
}

export function selectRelevantKnowledgeMatches<
  T extends KnowledgeRelevanceCandidate,
>(matches: T[]): T[] {
  const rerankerAvailable = matches.some(
    (match) =>
      typeof match.rerankerScore === "number" &&
      Number.isFinite(match.rerankerScore),
  );

  return matches.filter((match) => {
    if (!match.content.trim()) {
      return false;
    }

    // When reranker scores exist, use them as the acceptance gate.
    // Do not let a high vector score override a weak reranker score.
    if (rerankerAvailable) {
      if (
        typeof match.rerankerScore !== "number" ||
        !Number.isFinite(match.rerankerScore)
      ) {
        return false;
      }

      return (
        normalizeRerankerScore(match.rerankerScore) >=
        MIN_RERANKER_RELEVANCE_SCORE
      );
    }

    // If reranking failed or produced no usable scores,
    // preserve the existing vector-score fallback.
    return (
      Number.isFinite(match.score) &&
      match.score >= MIN_VECTOR_RELEVANCE_SCORE
    );
  });
}

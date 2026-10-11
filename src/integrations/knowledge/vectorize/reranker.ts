import type {
  KnowledgeSearchMatch,
} from "./retriever";

const RERANKER_MODEL =
  "@cf/baai/bge-reranker-base";

interface RerankerResponseItem {
  id: number;
  score: number;
}

interface BGERerankerInput {
  query: string;
  contexts: Array<{
    text: string;
  }>;
  top_k?: number;
}

interface RerankerResponse {
  response?: RerankerResponseItem[];
}

const MAX_RERANK_INPUT_CHARS = 1800;

export const MAX_RERANK_CANDIDATES = 20;

export async function rerankKnowledgeMatches(
  ai: Ai,
  query: string,
  matches: KnowledgeSearchMatch[],
  topK = 20,
): Promise<KnowledgeSearchMatch[]> {
  const safeTopK = Math.min(
  Math.max(Math.floor(topK), 1),
  MAX_RERANK_CANDIDATES,
);

  const candidates = matches.slice(0, safeTopK);

  if (!query.trim()) {
    return candidates.map(
      (match, index) => ({
        ...match,
        rerankerRank: index + 1,
      }),
    );
  }

  const contexts = candidates.map((match) => ({
    text: [
      match.title
        ? `Title: ${match.title}`
        : "",
      match.sourceType
        ? `Type: ${match.sourceType}`
        : "",
      match.content.slice(
        0,
        MAX_RERANK_INPUT_CHARS,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  }));

const runReranker = ai.run as unknown as (
  this: Ai,
  model: string,
  inputs: BGERerankerInput,
) => Promise<RerankerResponse>;

const result = await runReranker.call(
  ai,
  RERANKER_MODEL,
  {
    query: query.slice(0, 1000),
    contexts,
    top_k: candidates.length,
  },
);

  if (
    !Array.isArray(result.response) ||
    result.response.length === 0
  ) {
    throw new Error(
      "BGE reranker returned no ranked candidates.",
    );
  }

  const scores = new Map<number, number>();

  for (const item of result.response) {
    if (
      Number.isInteger(item.id) &&
      item.id >= 0 &&
      item.id < candidates.length &&
      Number.isFinite(item.score)
    ) {
      scores.set(item.id, item.score);
    }
  }

  if (scores.size === 0) {
    throw new Error(
      "BGE reranker returned no valid candidate scores.",
    );
  }

  return candidates
    .map((match, index) => ({
      match,
      score: scores.get(index),
    }))
    .sort((left, right) => {
      const leftHasScore =
        typeof left.score === "number";

      const rightHasScore =
        typeof right.score === "number";

      if (leftHasScore !== rightHasScore) {
        return leftHasScore ? -1 : 1;
      }

      if (
        left.score !== undefined &&
        right.score !== undefined &&
        left.score !== right.score
      ) {
        return right.score - left.score;
      }

      return (
        (right.match.rrfScore ?? 0) -
        (left.match.rrfScore ?? 0)
      );
    })
    .map((item, index) => ({
      ...item.match,
      ...(item.score !== undefined
        ? { rerankerScore: item.score }
        : {}),
      rerankerRank: index + 1,
    }));
}
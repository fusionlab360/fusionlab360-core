import {
  searchKnowledgeVectors,
  type KnowledgeSearchMatch,
} from "../../integrations/knowledge/vectorize/retriever";

import {
  searchKnowledgeDocumentsLexically,
} from "./lexical-retriever";

import {
  MAX_RERANK_CANDIDATES,
  rerankKnowledgeMatches,
} from "../../integrations/knowledge/vectorize/reranker";

export interface KnowledgeSearchResult {
  query: string;
  tenantId: string;
  matches: KnowledgeSearchMatch[];
}

const RRF_K = 60;

function documentKey(
  match: KnowledgeSearchMatch,
): string {
  const identity =
    match.providerDocumentId?.trim();

  return [
    match.tenantId,
    match.provider,
    match.knowledgeSourceId,
    match.sourceType,
    identity || `id:${match.id}`,
  ].join("|");
}

export async function searchKnowledgeForTenant(
  ai: Ai,
  vectorize: Vectorize,
  tenantId: string,
  query: string,
  topK = 20,
  db?: D1Database,
  alternateQueries: string[] = [],
): Promise<KnowledgeSearchResult> {
  const safeTopK = Math.min(
    Math.max(Math.floor(topK), 1),
    20,
  );

  console.log("KNOWLEDGE RETRIEVAL SERVICE INPUT", {
    tenantId,
    queryType: typeof query,
    queryLength: typeof query === "string" ? query.length : -1,
    queryEmpty: typeof query === "string" && query.length === 0,
  });

  const vectorMatches = (
    await searchKnowledgeVectors(
      ai,
      vectorize,
      tenantId,
      query,
      safeTopK,
      alternateQueries,
    )
  ).filter(
    (match) => match.tenantId === tenantId,
  );

  let lexicalMatches: KnowledgeSearchMatch[] = [];

  if (db) {
    try {
      lexicalMatches =
        await searchKnowledgeDocumentsLexically(
          db,
          tenantId,
          query,
          safeTopK,
          alternateQueries,
        );
    } catch (error: unknown) {
      console.warn(
        "Tenant-scoped BM25 retrieval failed; using vector results.",
        {
          tenantId,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
  }

  lexicalMatches = lexicalMatches.filter(
      (match) => match.tenantId === tenantId,
    );

  const lexicalByDocument = new Map<
    string,
    {
      match: KnowledgeSearchMatch;
      rank: number;
    }
  >();

  lexicalMatches.forEach((match, index) => {
    const key = documentKey(match);

    if (!lexicalByDocument.has(key)) {
      lexicalByDocument.set(key, {
        match,
        rank: index + 1,
      });
    }
  });

  // Only the highest-ranked vector chunk for a document
  // receives that document's BM25 contribution. This avoids
  // giving every chunk the same extra lexical vote.
  const bestVectorRankByDocument =
    new Map<string, number>();

  vectorMatches.forEach((match, index) => {
    const key = documentKey(match);

    if (!bestVectorRankByDocument.has(key)) {
      bestVectorRankByDocument.set(
        key,
        index + 1,
      );
    }
  });

  const vectorDocumentKeys = new Set(
    vectorMatches.map(documentKey),
  );

  const fusedVectors =
    vectorMatches.map(
      (
        match,
        index,
      ): KnowledgeSearchMatch => {
        const vectorRank = index + 1;
        const key = documentKey(match);
        const lexical =
          lexicalByDocument.get(key);

        const receivesLexicalVote =
          lexical !== undefined &&
          bestVectorRankByDocument.get(key) ===
            vectorRank;

        const rrfScore =
          1 / (RRF_K + vectorRank) +
          (
            receivesLexicalVote && lexical
              ? 1 / (RRF_K + lexical.rank)
              : 0
          );

        return {
          ...match,
          retrievalMethod:
            receivesLexicalVote
              ? "hybrid"
              : "vector",
          vectorRank,
          lexicalRank:
            receivesLexicalVote
              ? lexical?.rank
              : undefined,
          lexicalScore:
            receivesLexicalVote
              ? lexical?.match.lexicalScore
              : undefined,
          rrfScore,
        };
      },
    );

  const lexicalOnly =
    lexicalMatches
      .filter(
        (match) =>
          !vectorDocumentKeys.has(
            documentKey(match),
          ),
      )
      .map(
        (
          match,
        ): KnowledgeSearchMatch => ({
          ...match,
          score: 0,
          retrievalMethod: "lexical",
          vectorRank: undefined,
          rrfScore:
            1 / (
              RRF_K +
              (match.lexicalRank ?? 1)
            ),
        }),
      );
  const rerankCandidateLimit = Math.min(
    MAX_RERANK_CANDIDATES,
    safeTopK * 3,
  );

  const rrfCandidates = [
    ...fusedVectors,
    ...lexicalOnly,
  ]
    .sort(
      (left, right) =>
        (right.rrfScore ?? 0) -
          (left.rrfScore ?? 0) ||
        right.score - left.score,
    )
    .slice(0, rerankCandidateLimit);

  let matches = rrfCandidates;

  if (rrfCandidates.length > 0) {
    try {
      matches = await rerankKnowledgeMatches(
        ai,
        query,
        rrfCandidates,
        rerankCandidateLimit,
      );
    } catch (error: unknown) {
      console.warn(
        "Knowledge neural reranking failed; preserving RRF order.",
        {
          tenantId,
          candidateCount: rrfCandidates.length,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
    } else {
    matches = rrfCandidates.map(
      (match, index) => ({
        ...match,
        rerankerRank: index + 1,
      }),
    );
  }

  // Final defense-in-depth tenant boundary.
  matches = matches.filter(
    (match) => match.tenantId === tenantId,
  );

  console.log(
    "KNOWLEDGE HYBRID RETRIEVAL",
    {
      tenantId,
      queryLength: query.length,
      vectorCount: vectorMatches.length,
      lexicalCount: lexicalMatches.length,
      rrfCandidateCount: rrfCandidates.length,
      rerankerSucceeded:
        matches.some(
          (match) =>
            typeof match.rerankerScore === "number",
        ),
      topCandidates:
        matches.slice(0, 10).map(
          (match, index) => ({
            rank: index + 1,
            title: match.title,
            sourceType: match.sourceType,
            retrievalMethod:
              match.retrievalMethod ?? "unknown",
            vectorScore: match.score,
            rrfScore: match.rrfScore ?? null,
            vectorRank: match.vectorRank ?? null,
            lexicalRank: match.lexicalRank ?? null,
            rerankerScore:
              match.rerankerScore ?? null,
            rerankerRank:
              match.rerankerRank ?? null,
          }),
        ),
    },
  );

    return {
    query,
    tenantId,
    matches: matches.slice(0, safeTopK),
  };
}
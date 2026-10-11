import {
  createKnowledgeEmbeddings,
} from "./embedding";


export interface KnowledgeSearchMatch {

  id:
    string;

  score:
    number;

  tenantId:
    string;

  provider:
    string;

  sourceType:
    string;

  knowledgeSourceId:
    string;

  providerDocumentId:
    string;

  title:
    string;

  chunkIndex:
    number;

  content:
    string;

  retrievalMethod?:
    "vector" | "lexical" | "hybrid";
  rrfScore?:
    number;
  vectorRank?:
    number;
  lexicalRank?:
    number;
  lexicalScore?:
    number;

  rerankerScore?: number;
  rerankerRank?: number;
}


interface KnowledgeVectorMetadata {

  tenantId?:
    string;

  provider?:
    string;

  sourceType?:
    string;

  knowledgeSourceId?:
    string;

  providerDocumentId?:
    string;

  title?:
    string;

  chunkIndex?:
    number;

  content?:
    string;
}


const RETRIEVAL_STOP_WORDS =
  new Set<string>([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "what",
    "which",
    "where",
    "when",
    "who",
    "why",
    "how",
    "is",
    "are",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "you",
    "your",
    "we",
    "our",
    "i",
    "me",
    "my",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "with",
    "about",
    "please",
    "tell",
    "give",
    "know",

    "apa",
    "adakah",
    "boleh",
    "nak",
    "mahu",
    "ingin",
    "berapa",
    "bila",
    "mana",
    "yang",
    "dan",
    "atau",
    "dengan",
    "untuk",
    "dari",
  ]);


function buildRetrievalQueryVariants(
  query: string,
  alternateQueries: string[] = [],
): string[] {
  const variants: string[] = [];

  for (const sourceQuery of [
    query,
    ...alternateQueries,
  ]) {
    const normalized = sourceQuery
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      continue;
    }

    const tokens = normalized.split(" ").filter(Boolean);

    const compactTokens = tokens.filter(
      (token) =>
        !RETRIEVAL_STOP_WORDS.has(
          token.toLowerCase(),
        ),
    );

    variants.push(normalized);

    const compact = compactTokens.join(" ");

    if (compact) {
      variants.push(compact);
    }
  }

  return [...new Set(variants)].slice(0, 6);
}


export async function searchKnowledgeVectors(
  ai: Ai,
  vectorize: Vectorize,
  tenantId: string,
  query: string,
  topK: number = 5,
  alternateQueries: string[] = [],
): Promise<KnowledgeSearchMatch[]> {

  const normalizedQuery =
    query.trim();

  if (
    !normalizedQuery
  ) {
    return [];
  }

  const safeTopK =
    Math.min(
      Math.max(
        Math.floor(
          topK,
        ),
        1,
      ),
      20,
    );

  /*
   * --------------------------------------------------
   * Build retrieval variants
   * --------------------------------------------------
   */

  const queryVariants =
  buildRetrievalQueryVariants(
    normalizedQuery,
    alternateQueries,
  );

  if (
    queryVariants.length ===
    0
  ) {
    return [];
  }

  /*
   * --------------------------------------------------
   * Create all embeddings in one Workers AI call
   * --------------------------------------------------
   */

  const embeddingResult =
    await createKnowledgeEmbeddings(
      ai,
      queryVariants,
    );

  if (
    embeddingResult.vectors.length !==
    queryVariants.length
  ) {
    throw new Error(
      "Knowledge retrieval embedding count did not match query variant count.",
    );
  }

  /*
   * --------------------------------------------------
   * Run Vectorize searches for each query variant
   * --------------------------------------------------
   */

  const responses =
    await Promise.all(
      embeddingResult.vectors.map(
        (
          queryVector,
        ) =>
          vectorize.query(
            queryVector,
            {
              topK:
                safeTopK,

              namespace:
                tenantId,

              returnMetadata:
                "all",
            },
          ),
      ),
    );

  /*
   * --------------------------------------------------
   * Merge duplicate vector matches
   * --------------------------------------------------
   *
   * Keep the strongest semantic score for each
   * chunk. This allows either the original question
   * or the compact entity-focused query to discover
   * the document.
   * --------------------------------------------------
   */

  const merged =
    new Map<
      string,
      KnowledgeSearchMatch
    >();

  for (
    const response of
      responses
  ) {

    for (
      const match of
        response.matches ?? []
    ) {

      const metadata =
        (
          match.metadata ??
          {}
        ) as KnowledgeVectorMetadata;

      // Fail closed: vector metadata must confirm the requested tenant.
      if (metadata.tenantId !== tenantId) {
        continue;
      }

      const normalizedMatch:
        KnowledgeSearchMatch = {

        id:
          match.id,

        score:
          match.score,

        tenantId:
          metadata.tenantId ??
          tenantId,

        provider:
          metadata.provider ??
          "",

        sourceType:
          metadata.sourceType ??
          "",

        knowledgeSourceId:
          metadata.knowledgeSourceId ??
          "",

        providerDocumentId:
          metadata.providerDocumentId ??
          "",

        title:
          metadata.title ??
          "",

        chunkIndex:
          metadata.chunkIndex ??
          0,

        content:
          metadata.content ??
          "",
        retrievalMethod:
          "vector",
      };

      const existing =
        merged.get(
          normalizedMatch.id,
        );

      if (
        !existing ||
        normalizedMatch.score >
          existing.score
      ) {

        merged.set(
          normalizedMatch.id,
          normalizedMatch,
        );

      }

    }

  }

  /*
   * --------------------------------------------------
   * Final ranking
   * --------------------------------------------------
   */

  return [
    ...merged.values(),
  ]
    .sort(
      (
        left,
        right,
      ) =>
        right.score -
        left.score,
    )
    .slice(
      0,
      safeTopK,
    );
}
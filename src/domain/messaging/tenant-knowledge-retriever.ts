import {
  searchKnowledgeForTenant,
} from "../knowledge/retrieval-service";

import type {
  KnowledgeSearchMatch,
} from "../../integrations/knowledge/vectorize/retriever";

import type {
  KnowledgeContextItem,
} from "./knowledge-intelligence";

export interface TenantKnowledgeRetrieverOptions {
  ai: Ai;
  vectorize: Vectorize;
  tenantId: string;
  db?: D1Database;
  topK?: number;
}

export interface TenantKnowledgeRetriever {
  search(
    query: string,
    originalQuery?: string,
  ): Promise<KnowledgeContextItem[]>;
}

/**
 * Preserve the evidence identity and ranking metadata returned by
 * the tenant-scoped retrieval service.
 *
 * Both production messaging and retrieval evaluation should use this
 * mapper so source identifiers cannot be lost between layers.
 */
export function mapKnowledgeSearchMatchToContextItem(
  match: KnowledgeSearchMatch,
): KnowledgeContextItem {
  return {
    id: match.id,
    knowledgeSourceId: match.knowledgeSourceId,
    providerDocumentId: match.providerDocumentId,
    chunkIndex: match.chunkIndex,

    title: match.title,
    sourceType: match.sourceType,
    content: match.content,
    score: match.score,

    retrievalMethod: match.retrievalMethod,
    rrfScore: match.rrfScore,
    vectorRank: match.vectorRank,
    lexicalRank: match.lexicalRank,
    lexicalScore: match.lexicalScore,
    rerankerScore: match.rerankerScore,
    rerankerRank: match.rerankerRank,
  };
}

/**
 * Shared tenant-scoped adapter for production messaging and
 * retrieval evaluation. It uses the existing hybrid retriever;
 * it does not create a parallel retrieval implementation.
 */
export function createTenantKnowledgeRetriever(
  options: TenantKnowledgeRetrieverOptions,
): TenantKnowledgeRetriever {
  const configuredTopK =
    typeof options.topK === "number" &&
    Number.isFinite(options.topK)
      ? Math.floor(options.topK)
      : 20;

  const topK = Math.min(
    Math.max(configuredTopK, 1),
    20,
  );

  return {
    async search(
      query: string,
      originalQuery?: string,
    ): Promise<KnowledgeContextItem[]> {
      const alternateQueries =
        originalQuery?.trim() &&
        originalQuery.trim() !== query.trim()
          ? [originalQuery.trim()]
          : [];

      const result = await searchKnowledgeForTenant(
        options.ai,
        options.vectorize,
        options.tenantId,
        query,
        topK,
        options.db,
        alternateQueries,
      );

      // Defence in depth: don't let the evaluation or messaging
      // adapter surface results belonging to another tenant.
      return result.matches
        .filter(
          (match) => match.tenantId === options.tenantId,
        )
        .map(mapKnowledgeSearchMatchToContextItem);
    },
  };
}
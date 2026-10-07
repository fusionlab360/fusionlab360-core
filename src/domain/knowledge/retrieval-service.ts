import {
  searchKnowledgeVectors,
  type KnowledgeSearchMatch,
} from "../../integrations/knowledge/vectorize/retriever";

export interface KnowledgeSearchResult {
  query:
    string;

  tenantId:
    string;

  matches:
    KnowledgeSearchMatch[];
}

export async function searchKnowledgeForTenant(
  ai:
    Ai,

  vectorize:
    Vectorize,

  tenantId:
    string,

  query:
    string,

  topK:
    number = 8,
): Promise<
  KnowledgeSearchResult
> {

  const matches =
    await searchKnowledgeVectors(
      ai,

      vectorize,

      tenantId,

      query,

      topK,
    );

  return {
    query,

    tenantId,

    matches,
  };
}
import type {
  KnowledgeContext,
} from "../../core/knowledge";

import {
  resolveKnowledgeProvider,
} from "../../core/knowledge";


export async function getKnowledgeBases(
  context:
    KnowledgeContext,
) {

  const provider =
    resolveKnowledgeProvider(
      context
        .tenant
        .integrations
        .crm
        .provider,
    );


  return provider.listKnowledgeBases(
    context,
  );
}


export async function getKnowledgeDocuments(
  context:
    KnowledgeContext,

  knowledgeBaseId:
    string,
) {

  const provider =
    resolveKnowledgeProvider(
      context
        .tenant
        .integrations
        .crm
        .provider,
    );


  return provider.listDocuments(
    context,

    knowledgeBaseId,
  );
}
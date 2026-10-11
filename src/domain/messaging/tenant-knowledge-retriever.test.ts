import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  KnowledgeSearchMatch,
} from "../../integrations/knowledge/vectorize/retriever";

import {
  mapKnowledgeSearchMatchToContextItem,
} from "./tenant-knowledge-retriever";

test(
  "tenant retriever adapter preserves stable source identity",
  () => {
    const match = {
      id: "chunk-001",
      tenantId: "tenant-a",
      provider: "test-provider",
      sourceType: "rich_text",
      knowledgeSourceId: "source-001",
      providerDocumentId: "document-001",
      title: "Services",
      chunkIndex: 3,
      content: "The clinic provides physiotherapy.",
      score: 0.95,
      retrievalMethod: "hybrid",
      rrfScore: 0.03,
      vectorRank: 1,
      lexicalRank: 1,
      lexicalScore: 0.91,
      rerankerScore: 0.97,
      rerankerRank: 1,
    } satisfies KnowledgeSearchMatch;

    const result =
      mapKnowledgeSearchMatchToContextItem(match);

    assert.equal(result.id, "chunk-001");
    assert.equal(result.knowledgeSourceId, "source-001");
    assert.equal(result.providerDocumentId, "document-001");
    assert.equal(result.chunkIndex, 3);
  },
);

test(
  "tenant retriever adapter preserves content and ranking metadata",
  () => {
    const match = {
      id: "chunk-002",
      tenantId: "tenant-a",
      provider: "test-provider",
      sourceType: "rich_text",
      knowledgeSourceId: "source-002",
      providerDocumentId: "document-002",
      title: "Opening hours",
      chunkIndex: 0,
      content: "Opening hours are documented here.",
      score: 0.88,
      retrievalMethod: "hybrid",
      rrfScore: 0.028,
      vectorRank: 2,
      lexicalRank: 1,
      lexicalScore: 0.84,
      rerankerScore: 0.93,
      rerankerRank: 1,
    } satisfies KnowledgeSearchMatch;

    const result =
      mapKnowledgeSearchMatchToContextItem(match);

    assert.equal(result.title, "Opening hours");
    assert.equal(
      result.content,
      "Opening hours are documented here.",
    );
    assert.equal(result.score, 0.88);
    assert.equal(result.retrievalMethod, "hybrid");
    assert.equal(result.rrfScore, 0.028);
    assert.equal(result.vectorRank, 2);
    assert.equal(result.lexicalRank, 1);
    assert.equal(result.lexicalScore, 0.84);
    assert.equal(result.rerankerScore, 0.93);
    assert.equal(result.rerankerRank, 1);
  },
);
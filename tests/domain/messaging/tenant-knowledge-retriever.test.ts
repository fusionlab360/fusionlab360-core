import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  KnowledgeSearchMatch,
} from "../../../src/integrations/knowledge/vectorize/retriever";

import {
  createTenantKnowledgeRetriever,
  mapKnowledgeSearchMatchToContextItem,
} from "../../../src/domain/messaging/tenant-knowledge-retriever";

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

test(
  "tenant-scoped recovery excludes matching documents owned by another tenant",
  async () => {
    const namespaces: string[] = [];
    const matches = [
      {
        id: "other-tenant-address",
        score: 0.99,
        metadata: {
          tenantId: "tenant-b",
          provider: "test-provider",
          sourceType: "rich_text",
          knowledgeSourceId: "source-b",
          providerDocumentId: "document-b",
          title: "Branch address",
          chunkIndex: 0,
          content: "The address is 4 Hill Street.",
        },
      },
      {
        id: "same-tenant-address",
        score: 0.8,
        metadata: {
          tenantId: "tenant-a",
          provider: "test-provider",
          sourceType: "rich_text",
          knowledgeSourceId: "source-a",
          providerDocumentId: "document-a",
          title: "Branch address",
          chunkIndex: 0,
          content: "The address is 20 Market Road.",
        },
      },
    ];
    const retriever = createTenantKnowledgeRetriever({
      tenantId: "tenant-a",
      ai: {
        async run(model: string, input: unknown) {
          if (model.includes("reranker")) {
            const contexts = (input as { contexts: unknown[] }).contexts;
            return {
              response: contexts.map((_, id) => ({ id, score: 0.9 - id * 0.1 })),
            };
          }
          const texts = (input as { text: string[] }).text;
          return { data: texts.map(() => Array(1024).fill(0)) };
        },
      } as unknown as Ai,
      vectorize: {
        async query(_vector: number[], options: { namespace?: string }) {
          namespaces.push(options.namespace ?? "");
          return { matches };
        },
      } as unknown as Vectorize,
    });

    const result = await retriever.search("Rimbayu street address");

    assert.ok(namespaces.length > 0);
    assert.equal(namespaces.every((namespace) => namespace === "tenant-a"), true);
    assert.deepEqual(result.map((item) => item.id), ["same-tenant-address"]);
    assert.equal(result.some((item) => item.content.includes("4 Hill Street")), false);
  },
);

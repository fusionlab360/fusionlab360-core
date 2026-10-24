
import test from "node:test";
import assert from "node:assert/strict";

import {
  searchKnowledgeForTenant,
} from "../../../src/domain/knowledge/retrieval-service";

function createMetadata(
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: "test-provider",
    sourceType: "rich_text",
    knowledgeSourceId: "source-1",
    providerDocumentId: "document-1",
    title: "Tenant isolation regression",
    chunkIndex: 0,
    content: "Test knowledge content",
    ...overrides,
  };
}

test(
  "tenant retrieval never returns vectors belonging to another tenant",
  async () => {
    const namespaces: string[] = [];

    const ai = {
      run: async (
        model: string,
        input: unknown,
      ) => {
        const options =
          typeof input === "object" && input !== null
            ? input as Record<string, unknown>
            : {};

        if (model.toLowerCase().includes("reranker")) {
          const contexts = Array.isArray(options.contexts)
            ? options.contexts
            : [];

          return {
            response: contexts.map((_, index) => ({
              id: index,
              score: 1,
            })),
          };
        }

        const texts = Array.isArray(options.text)
          ? options.text
          : [];

        return {
          data: texts.map(
            () => Array<number>(1024).fill(0),
          ),
        };
      },
    } as unknown as Ai;

    const vectorize = {
      query: async (
        _vector: number[],
        options?: { namespace?: string },
      ) => {
        namespaces.push(options?.namespace ?? "");

        return {
          matches: [
            {
              id: "tenant-a-chunk",
              score: 0.95,
              metadata: createMetadata({
                tenantId: "tenant-a",
              }),
            },
            {
              id: "tenant-b-chunk",
              score: 0.99,
              metadata: createMetadata({
                tenantId: "tenant-b",
                content: "Private tenant B content",
              }),
            },
            {
              id: "missing-tenant-chunk",
              score: 0.98,
              metadata: createMetadata(),
            },
          ],
        };
      },
    } as unknown as Vectorize;

    const result = await searchKnowledgeForTenant(
      ai,
      vectorize,
      "tenant-a",
      "What are the opening hours?",
      5,
    );

    assert.equal(result.tenantId, "tenant-a");

    assert.ok(
      result.matches.every(
        (match) => match.tenantId === "tenant-a",
      ),
      "Every returned match must belong to the requested tenant",
    );

    assert.ok(
      result.matches.some(
        (match) => match.id === "tenant-a-chunk",
      ),
      "The correctly scoped tenant result should remain available",
    );

    assert.ok(
      !result.matches.some(
        (match) =>
          match.id === "tenant-b-chunk" ||
          match.id === "missing-tenant-chunk",
      ),
      "Other-tenant and unverified-tenant results must not be returned",
    );

    assert.ok(namespaces.length > 0);

    assert.ok(
      namespaces.every(
        (namespace) => namespace === "tenant-a",
      ),
      "Every Vectorize query must use the requested tenant namespace",
    );
  },
);

test(
  "hybrid retrieval merges lexical evidence and retains lexical-only documents",
  async () => {
    const ai = {
      run: async (model: string, input: unknown) => {
        const options =
          typeof input === "object" && input !== null
            ? input as Record<string, unknown>
            : {};

        if (model.toLowerCase().includes("reranker")) {
          const contexts = Array.isArray(options.contexts)
            ? options.contexts
            : [];

          return {
            response: contexts.map((_, index) => ({
              id: index,
              score: contexts.length - index,
            })),
          };
        }

        const texts = Array.isArray(options.text)
          ? options.text
          : [];

        return {
          data: texts.map(() => Array<number>(1024).fill(0)),
        };
      },
    } as unknown as Ai;

    const vectorize = {
      query: async () => ({
        matches: [
          {
            id: "vector-services",
            score: 0.9,
            metadata: createMetadata({
              tenantId: "tenant-a",
              providerDocumentId: "services-doc",
              title: "Services",
              content: "Clinic services and medical care",
            }),
          },
          {
            id: "vector-branch",
            score: 0.8,
            metadata: createMetadata({
              tenantId: "tenant-a",
              providerDocumentId: "branch-doc",
              knowledgeSourceId: "source-2",
              title: "Branch details",
              content: "Branch address and contact details",
            }),
          },
        ],
      }),
    } as unknown as Vectorize;

    const lexicalRows = [
      {
        id: "services-row",
        tenant_id: "tenant-a",
        provider: "test-provider",
        knowledge_source_id: "source-1",
        provider_document_id: "services-doc",
        source_type: "rich_text",
        title: "Services",
        content: "Clinic services and medical care",
        bm25_score: -2,
      },
      {
        id: "lexical-only-row",
        tenant_id: "tenant-a",
        provider: "test-provider",
        knowledge_source_id: "source-3",
        provider_document_id: "policy-doc",
        source_type: "rich_text",
        title: "Clinic policy",
        content: "Relevant policy details discovered through lexical search",
        bm25_score: -1,
      },
    ];

    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: lexicalRows }),
        }),
      }),
    } as unknown as D1Database;

    const result = await searchKnowledgeForTenant(
      ai,
      vectorize,
      "tenant-a",
      "clinic services policy",
      5,
      db,
    );

    assert.equal(result.tenantId, "tenant-a");

    const services = result.matches.find(
      (match) => match.providerDocumentId === "services-doc",
    );

    assert.ok(services, "Vector-retrieved services should remain available");
    assert.equal(
      services.retrievalMethod,
      "hybrid",
      "A document found by both retrievers should be marked hybrid",
    );
    assert.equal(services.lexicalRank, 1);

    const lexicalOnly = result.matches.find(
      (match) => match.providerDocumentId === "policy-doc",
    );

    assert.ok(
      lexicalOnly,
      "A document found only through lexical retrieval should be retained",
    );
    assert.equal(lexicalOnly.retrievalMethod, "lexical");

    assert.ok(
      result.matches.every((match) => match.tenantId === "tenant-a"),
      "All final results must remain tenant-scoped",
    );
  },
);

test(
  "reranker failure preserves RRF ordering and tenant isolation",
  async () => {
    let rerankerCalls = 0;

    const ai = {
      run: async (model: string, input: unknown) => {
        if (model.toLowerCase().includes("reranker")) {
          rerankerCalls++;
          throw new Error("Simulated reranker outage");
        }

        const options =
          typeof input === "object" && input !== null
            ? input as Record<string, unknown>
            : {};

        const texts = Array.isArray(options.text)
          ? options.text
          : [];

        return {
          data: texts.map(() => Array<number>(1024).fill(0)),
        };
      },
    } as unknown as Ai;

    const vectorize = {
      query: async () => ({
        matches: [
          {
            id: "vector-first",
            score: 0.95,
            metadata: createMetadata({
              tenantId: "tenant-a",
              providerDocumentId: "document-first",
              title: "First document",
              content: "First relevant document",
            }),
          },
          {
            id: "vector-second",
            score: 0.8,
            metadata: createMetadata({
              tenantId: "tenant-a",
              providerDocumentId: "document-second",
              knowledgeSourceId: "source-2",
              title: "Second document",
              content: "Second relevant document",
            }),
          },
          {
            id: "foreign-tenant",
            score: 0.99,
            metadata: createMetadata({
              tenantId: "tenant-b",
              providerDocumentId: "foreign-document",
              content: "Must never be returned",
            }),
          },
        ],
      }),
    } as unknown as Vectorize;

    const lexicalRows = [
      {
        id: "lexical-first",
        tenant_id: "tenant-a",
        provider: "test-provider",
        knowledge_source_id: "source-1",
        provider_document_id: "document-first",
        source_type: "rich_text",
        title: "First document",
        content: "First relevant document",
        bm25_score: -2,
      },
      {
        id: "lexical-only",
        tenant_id: "tenant-a",
        provider: "test-provider",
        knowledge_source_id: "source-3",
        provider_document_id: "document-lexical",
        source_type: "rich_text",
        title: "Lexical document",
        content: "A document found by lexical retrieval",
        bm25_score: -1,
      },
    ];

    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: lexicalRows }),
        }),
      }),
    } as unknown as D1Database;

    const result = await searchKnowledgeForTenant(
      ai,
      vectorize,
      "tenant-a",
      "relevant document",
      2,
      db,
    );

    assert.equal(rerankerCalls, 1);
    assert.equal(result.tenantId, "tenant-a");
    assert.equal(result.matches.length, 2);

    assert.deepEqual(
      result.matches.map((match) => match.providerDocumentId),
      ["document-first", "document-second"],
      "RRF order should be preserved when reranking fails",
    );

    assert.ok(
      result.matches.every((match) => match.tenantId === "tenant-a"),
      "Foreign-tenant evidence must never be returned",
    );

    assert.ok(
      result.matches.every(
        (match) => typeof match.rrfScore === "number",
      ),
      "Fallback results should retain their RRF scores",
    );
  },
);

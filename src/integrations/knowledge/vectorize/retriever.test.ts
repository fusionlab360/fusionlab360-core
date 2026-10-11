import test from "node:test";
import assert from "node:assert/strict";

import {
  searchKnowledgeVectors,
} from "./retriever";

function createMetadata(
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: "test-provider",
    sourceType: "rich_text",
    knowledgeSourceId: "source-1",
    providerDocumentId: "document-1",
    title: "Tenant isolation test",
    chunkIndex: 0,
    content: "Tenant-scoped test content",
    ...overrides,
  };
}

async function searchWithMetadata(
  metadata: Record<string, unknown>,
) {
  const namespaces: string[] = [];

  const ai = {
    run: async (
      _model: string,
      input: unknown,
    ) => {
      const options =
        typeof input === "object" && input !== null
          ? input as Record<string, unknown>
          : {};

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
            id: "chunk-1",
            score: 0.9,
            metadata,
          },
        ],
      };
    },
  } as unknown as Vectorize;

  const matches = await searchKnowledgeVectors(
    ai,
    vectorize,
    "tenant-a",
    "What are the opening hours?",
  );

  return { matches, namespaces };
}

test("accepts vectors with matching tenant metadata", async () => {
  const { matches, namespaces } =
    await searchWithMetadata(
      createMetadata({ tenantId: "tenant-a" }),
    );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].tenantId, "tenant-a");
  assert.ok(namespaces.length > 0);
  assert.ok(
    namespaces.every(
      (namespace) => namespace === "tenant-a",
    ),
  );
});

test("rejects vectors with another tenant's metadata", async () => {
  const { matches } = await searchWithMetadata(
    createMetadata({ tenantId: "tenant-b" }),
  );

  assert.deepEqual(matches, []);
});

test("rejects vectors with missing tenant metadata", async () => {
  const { matches } = await searchWithMetadata(
    createMetadata(),
  );

  assert.deepEqual(matches, []);
});

import test from "node:test";
import assert from "node:assert/strict";

import type {
  AIProvider,
} from "../../../src/core/ai/contracts";

import {
  answerKnowledgeQuestion,
} from "../../../src/domain/knowledge/answer-service";

const VALID_ANSWER = JSON.stringify({
  status: "full",
  answer: "The clinic is open from 9 AM to 6 PM.",
  claims: [
    {
      text: "The clinic is open from 9 AM to 6 PM.",
      chunk_id: "K1",
      quote: "The clinic is open from 9 AM to 6 PM.",
    },
  ],
});

function createTestDependencies() {

const ai = {
  run: async (
    model: string,
    input: unknown,
  ) => {
    const options =
      typeof input === "object" && input !== null
        ? input as Record<string, unknown>
        : {};

    // Simulate the BGE neural reranker response format.
    if (model.includes("reranker")) {
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

    // Simulate the embedding model response format.
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
    query: async () => ({
      matches: [
        {
          id: "chunk-1",
          score: 0.9,
          metadata: {
            tenantId: "test-tenant",
            provider: "test-provider",
            sourceType: "rich_text",
            knowledgeSourceId: "source-1",
            providerDocumentId: "document-1",
            title: "Opening hours",
            chunkIndex: 0,
            content:
              "The clinic is open from 9 AM to 6 PM.",
          },
        },
      ],
    }),
  } as unknown as Vectorize;

  return {
    ai,
    vectorize,
  };
}

function createProvider(
  primaryText: string,
  fallbackText: string,
) {
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const provider: AIProvider = {
    async chat() {
      primaryCalls += 1;

      return {
        text: primaryText,
        provider: "mock-primary",
        model: "mock-model",
      };
    },

    async chatFallback() {
      fallbackCalls += 1;

      return {
        text: fallbackText,
        provider: "mock-fallback",
        model: "mock-model",
      };
    },
  };

  return {
    provider,
    getCalls: () => ({
      primaryCalls,
      fallbackCalls,
    }),
  };
}

test("Knowledge answer retries invalid output and returns verified evidence", async () => {
  const { ai, vectorize } = createTestDependencies();

  const mock = createProvider(
    "not valid JSON",
    VALID_ANSWER,
  );

  const result = await answerKnowledgeQuestion(
    mock.provider,
    ai,
    vectorize,
    "test-tenant",
    "What are the clinic opening hours?",
    5,
  );

  assert.equal(result.grounded, true);
  assert.equal(result.answerStatus, "full");
  assert.equal(
    result.answer,
    "The clinic is open from 9 AM to 6 PM.",
  );

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, "chunk-1");

  assert.deepEqual(mock.getCalls(), {
    primaryCalls: 1,
    fallbackCalls: 1,
  });
});

test("Knowledge answer rejects output when both attempts fail verification", async () => {
  const { ai, vectorize } = createTestDependencies();

  const mock = createProvider(
    "not valid JSON",
    "still not valid JSON",
  );

  const result = await answerKnowledgeQuestion(
    mock.provider,
    ai,
    vectorize,
    "test-tenant",
    "What are the clinic opening hours?",
    5,
  );

  assert.equal(result.grounded, false);
  assert.equal(result.answerStatus, "invalid");
  assert.deepEqual(result.sources, []);

  assert.match(
    result.answer,
    /verified information/i,
  );

  assert.deepEqual(mock.getCalls(), {
    primaryCalls: 1,
    fallbackCalls: 1,
  });
});

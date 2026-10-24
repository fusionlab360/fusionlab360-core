
import test from "node:test";
import assert from "node:assert/strict";

import {
  answerKnowledgeController,
} from "../../../src/domain/knowledge/answer-controller";

test("Knowledge answer controller requires Gemini credentials for hybrid mode", async () => {
  const context = {
    req: {
      json: async () => ({
        query: "What are the opening hours?",
      }),
    },

    env: {
      AI: {},
      VECTORIZE_V2: {},
      GEMINI_API_KEY: "",
    },

    get: () => ({
      tenant: {
        id: "test-tenant",
      },
    }),
  } as unknown as Parameters<
    typeof answerKnowledgeController
  >[0];

  await assert.rejects(
    () => answerKnowledgeController(context),
    /Hybrid AI provider selected but GEMINI_API_KEY is missing/,
  );
});

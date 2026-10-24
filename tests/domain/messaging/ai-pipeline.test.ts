import assert from "node:assert/strict";

import test from "node:test";

import type { AIProvider } from "../../../src/core/ai";

import {
  compareAIShadowAnswerToLiveReply,
  generateVerifiedKnowledgeAnswer,
  parseAIQueryPlan,
  planCustomerQuery,
  runAIKnowledgePipeline,
} from "../../../src/domain/messaging/ai-pipeline";

/* ==================================================
 * Query planner tests
 * ================================================== */

test("parses and trims a knowledge query", () => {
  assert.deepEqual(
    parseAIQueryPlan(
      '{"route":"knowledge","query":"  Northside Sunday hours  "}',
    ),
    {
      route: "knowledge",
      query: "Northside Sunday hours",
    },
  );
});

test("requires a valid clarification question", () => {
  assert.deepEqual(
    parseAIQueryPlan(
      '{"route":"clarify","clarificationQuestion":"Which branch do you mean?"}',
    ),
    {
      route: "clarify",
      clarificationQuestion:
        "Which branch do you mean?",
    },
  );

  assert.equal(
    parseAIQueryPlan(
      '{"route":"clarify","clarificationQuestion":" "}',
    ),
    null,
  );
});

test("accepts chit-chat and handoff routes", () => {
  assert.deepEqual(
    parseAIQueryPlan(
      '{"route":"chit_chat"}',
    ),
    {
      route: "chit_chat",
    },
  );

  assert.deepEqual(
    parseAIQueryPlan(
      '{"route":"handoff"}',
    ),
    {
      route: "handoff",
    },
  );
});

test("rejects malformed, unsupported and incomplete plans", () => {
  assert.equal(
    parseAIQueryPlan("not JSON"),
    null,
  );

  assert.equal(
    parseAIQueryPlan(
      '{"route":"unknown"}',
    ),
    null,
  );

  assert.equal(
    parseAIQueryPlan(
      '{"route":"knowledge","query":" "}',
    ),
    null,
  );

  assert.equal(
    parseAIQueryPlan(
      '{"route":"knowledge","query":4}',
    ),
    null,
  );
});

test("uses structured planning and bounds history to six messages", async () => {
  let capturedTask:
    string | undefined;

  let capturedPrompt = "";

  const ai: AIProvider = {
    async chat(request) {
      capturedTask = request.task;

      capturedPrompt =
        request.messages[1]?.content ?? "";

      return {
        text: JSON.stringify({
          route: "knowledge",
          query:
            "Northside Sunday opening hours",
          clarificationQuestion: "",
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const history = Array.from(
    { length: 8 },
    (_, index) => ({
      role: "customer" as const,
      text: `history-${index}`,
      timestamp:
        "2026-10-11T15:00:00.000Z",
    }),
  );

  const result = await planCustomerQuery({
    ai,
    customerMessage:
      "What about Sunday?",
    history,
  });

  assert.equal(
    capturedTask,
    "structured",
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.deepEqual(result.plan, {
    route: "knowledge",
    query:
      "Northside Sunday opening hours",
  });

  const prompt = JSON.parse(
    capturedPrompt,
  ) as {
    currentMessage: string;
    recentHistory: Array<{
      role: string;
      text: string;
    }>;
  };

  assert.equal(
    prompt.currentMessage,
    "What about Sunday?",
  );

  assert.equal(
    prompt.recentHistory.length,
    6,
  );

  assert.equal(
    prompt.recentHistory[0]?.text,
    "history-2",
  );

  assert.equal(
    prompt.recentHistory[5]?.text,
    "history-7",
  );
});

test("rejects a planner response marked as truncated", async () => {
  const ai: AIProvider = {
    async chat() {
      return {
        text:
          '{"route":"knowledge","query":"opening hours"}',
        provider: "test",
        model: "test-model",
        truncated: true,
      };
    },
  };

  assert.deepEqual(
    await planCustomerQuery({
      ai,
      customerMessage: "Opening hours?",
      history: [],
    }),
    {
      ok: false,
      reason: "invalid_output",
    },
  );
});

test("fails closed when the planner provider errors or returns invalid output", async () => {
  const failingAI: AIProvider = {
    async chat() {
      throw new Error(
        "private provider detail",
      );
    },
  };

  const invalidAI: AIProvider = {
    async chat() {
      return {
        text:
          '{"route":"knowledge","query":""}',
        provider: "test",
        model: "test-model",
      };
    },
  };

  const input = {
    customerMessage:
      "What are the opening hours?",
    history: [],
  };

  assert.deepEqual(
    await planCustomerQuery({
      ...input,
      ai: failingAI,
    }),
    {
      ok: false,
      reason: "provider_error",
    },
  );

  assert.deepEqual(
    await planCustomerQuery({
      ...input,
      ai: invalidAI,
    }),
    {
      ok: false,
      reason: "invalid_output",
    },
  );
});

/* ==================================================
 * Evidence answer tests
 * ================================================== */

test("returns an answer only when its evidence is verified", async () => {
  const sentence =
    "Northside branch is open on Sundays from 9 AM to 1 PM.";

  const ai: AIProvider = {
    async chat() {
      return {
        text: JSON.stringify({
          status: "full",
          answer: sentence,
          claims: [
            {
              text: sentence,
              chunk_id: "K1",
              quote: sentence,
            },
          ],
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result =
    await generateVerifiedKnowledgeAnswer({
      ai,
      customerMessage:
        "What are the Sunday hours?",
      retrievalQuery:
        "Northside Sunday opening hours",
      knowledge: [
        {
          title:
            "Northside opening hours",
          sourceType: "faq",
          content: sentence,
          score: 1,
        },
      ],
    });

  assert.equal(
    result.status,
    "answered",
  );

  if (result.status === "answered") {
    assert.equal(
      result.answer,
      sentence,
    );

    assert.equal(
      result.answerStatus,
      "full",
    );

    assert.deepEqual(
      result.evidenceIds,
      ["K1"],
    );
  }
});

test("returns no_answer without calling the provider when evidence is empty", async () => {
  let calls = 0;

  const ai: AIProvider = {
    async chat() {
      calls += 1;

      return {
        text: "",
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result =
    await generateVerifiedKnowledgeAnswer({
      ai,
      customerMessage:
        "What are the opening hours?",
      retrievalQuery:
        "opening hours",
      knowledge: [],
    });

  assert.equal(
    result.status,
    "no_answer",
  );

  assert.equal(calls, 0);
});

test("rejects an answer with an unsupported evidence quotation", async () => {
  const sentence =
    "Northside branch is open on Sundays from 9 AM to 1 PM.";

  const ai: AIProvider = {
    async chat() {
      return {
        text: JSON.stringify({
          status: "full",
          answer: sentence,
          claims: [
            {
              text: sentence,
              chunk_id: "K1",
              quote:
                "Northside branch is closed on Sundays.",
            },
          ],
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result =
    await generateVerifiedKnowledgeAnswer({
      ai,
      customerMessage:
        "What are the Sunday hours?",
      retrievalQuery:
        "Northside Sunday opening hours",
      knowledge: [
        {
          title:
            "Northside opening hours",
          sourceType: "faq",
          content: sentence,
          score: 1,
        },
      ],
    });

  assert.equal(
    result.status,
    "rejected",
  );
});

test("orchestrates planning, retrieval and verified generation", async () => {
  const sentence =
    "Northside branch is open on Sundays from 9 AM to 1 PM.";

  let providerCalls = 0;
  let capturedQuery = "";
  let capturedOriginalQuery = "";

  const ai: AIProvider = {
    async chat() {
      providerCalls += 1;

      if (providerCalls === 1) {
        return {
          text: JSON.stringify({
            route: "knowledge",
            query: "Northside Sunday opening hours",
            clarificationQuestion: "",
          }),
          provider: "test",
          model: "test-model",
        };
      }

      return {
        text: JSON.stringify({
          status: "full",
          answer: sentence,
          claims: [
            {
              text: sentence,
              chunk_id: "K1",
              quote: sentence,
            },
          ],
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result = await runAIKnowledgePipeline({
    ai,
    customerMessage: "What about Sunday?",
    history: [],
    retriever: {
      async search(query, originalQuery) {
        capturedQuery = query;
        capturedOriginalQuery = originalQuery ?? "";

        return [
          {
            title: "Northside opening hours",
            sourceType: "faq",
            content: sentence,
            score: 1,
          },
        ];
      },
    },
  });

  assert.equal(result.status, "answered");
  assert.equal(
    capturedQuery,
    "Northside Sunday opening hours",
  );
  assert.equal(
    capturedOriginalQuery,
    "What about Sunday?",
  );
  assert.equal(providerCalls, 2);

  if (result.status === "answered") {
    assert.equal(result.answer, sentence);
    assert.equal(result.answerStatus, "full");
    assert.deepEqual(result.evidenceIds, ["K1"]);
  }
});

test("does not retrieve knowledge for a handoff route", async () => {
  let retrievalCalls = 0;

  const ai: AIProvider = {
    async chat() {
      return {
        text: '{"route":"handoff"}',
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result = await runAIKnowledgePipeline({
    ai,
    customerMessage: "Please connect me to a person.",
    history: [],
    retriever: {
      async search() {
        retrievalCalls += 1;
        return [];
      },
    },
  });

  assert.deepEqual(result, {
    status: "handoff_required",
  });
  assert.equal(retrievalCalls, 0);
});

test("handles retrieval failure without exposing internal errors", async () => {
  const ai: AIProvider = {
    async chat() {
      return {
        text: JSON.stringify({
          route: "knowledge",
          query: "opening hours",
          clarificationQuestion: "",
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result = await runAIKnowledgePipeline({
    ai,
    customerMessage: "What are your opening hours?",
    history: [],
    retriever: {
      async search() {
        throw new Error("internal retrieval details");
      },
    },
  });

  assert.deepEqual(result, {
    status: "retrieval_failed",
  });
});

test("passes only selector-approved evidence to answer generation", async () => {
  const selectedEvidence =
    "Goolge Maps: [Goolge Maps](https://maps.app.goo.gl/yiR8qakiggd69vzt7)";

  const unrelatedEvidence =
    "Google Maps: [Map](https://maps.app.goo.gl/other-branch)";

  let providerCalls = 0;
  let generationPrompt = "";

  const ai: AIProvider = {
    async chat(request) {
      providerCalls += 1;

      if (providerCalls === 1) {
        return {
          text: JSON.stringify({
            route: "knowledge",
            query: "Give me Rimbayu location link",
            clarificationQuestion: "",
          }),
          provider: "test",
          model: "test-model",
        };
      }

      generationPrompt =
        request.messages[1]?.content ?? "";

      return {
        text: JSON.stringify({
          status: "full",
          answer: selectedEvidence,
          claims: [
            {
              text: selectedEvidence,
              chunk_id: "K1",
              quote: selectedEvidence,
            },
          ],
        }),
        provider: "test",
        model: "test-model",
      };
    },
  };

  const result = await runAIKnowledgePipeline({
    ai,
    customerMessage: "Give me Rimbayu location link",
    history: [],
    retriever: {
      async search() {
        return [
          {
            id: "rimbayu-branch-link-chunk",
            knowledgeSourceId: "synthetic-rimbayu-source",
            providerDocumentId: "synthetic-rimbayu-document",
            title: "Rimbayu Branch Information",
            sourceType: "rich_text",
            content: selectedEvidence,
            score: 0.95,
            rerankScore: 0.95,
            retrievalMethod: "hybrid",
          },
          {
            id: "other-branch-link-chunk",
            knowledgeSourceId: "synthetic-other-source",
            providerDocumentId: "synthetic-other-document",
            title: "Poliklinik Shaik @ Other Branch",
            sourceType: "rich_text",
            content: unrelatedEvidence,
            score: 0.1,
            rerankScore: 0.1,
            retrievalMethod: "hybrid",
          },
        ];
      },
    },
  });

  assert.equal(result.status, "answered");

  const generationInput = JSON.parse(
    generationPrompt,
  ) as {
    approvedKnowledgeContext: string;
  };

  assert.ok(
    generationInput.approvedKnowledgeContext.includes(
      "yiR8qakiggd69vzt7",
    ),
    "Expected the selected Rimbayu evidence in the generation context",
  );

  assert.equal(
    generationInput.approvedKnowledgeContext.includes(
      "other-branch",
    ),
    false,
    "Unselected branch evidence must not reach answer generation",
  );
});

test("shadow comparison matches answers after whitespace normalization", () => {
  const result = compareAIShadowAnswerToLiveReply(
    "The clinic is open on Sunday.",
    {
      status: "answered",
      answerStatus: "full",
      answer: "  The clinic is open \n on Sunday.  ",
      evidenceIds: ["evidence-1"],
      attempts: 1,
      fallbackUsed: false,
    },
  );

  assert.deepEqual(result, {
    comparable: true,
    normalizedExactMatch: true,
  });
});

test("shadow comparison identifies different answers", () => {
  const result = compareAIShadowAnswerToLiveReply(
    "The clinic is open on Sunday.",
    {
      status: "answered",
      answerStatus: "full",
      answer: "Please contact the clinic for its opening hours.",
      evidenceIds: ["evidence-1"],
      attempts: 1,
      fallbackUsed: false,
    },
  );

  assert.deepEqual(result, {
    comparable: true,
    normalizedExactMatch: false,
  });
});

test("shadow comparison rejects non-answer results as incomparable", () => {
  const result = compareAIShadowAnswerToLiveReply(
    "The clinic is open on Sunday.",
    {
      status: "answer_rejected",
      reason: "unsupported_evidence_quote",
      attempts: 1,
      fallbackUsed: false,
    },
  );

  assert.deepEqual(result, {
    comparable: false,
    normalizedExactMatch: null,
    reason: "candidate_not_answered",
  });
});

test("shadow comparison rejects empty answers", () => {
  const result = compareAIShadowAnswerToLiveReply(
    "The clinic is open on Sunday.",
    {
      status: "answered",
      answerStatus: "full",
      answer: "  \n ",
      evidenceIds: ["evidence-1"],
      attempts: 1,
      fallbackUsed: false,
    },
  );

  assert.deepEqual(result, {
    comparable: false,
    normalizedExactMatch: null,
    reason: "empty_answer",
  });
});

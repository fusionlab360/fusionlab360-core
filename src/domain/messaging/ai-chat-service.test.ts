
import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalInboundMessage } from "../../canonical/message";
import type {
  AIChatResponse,
  AIProvider,
} from "../../core/ai";
import {
  parseAndVerifyEvidenceAnswer,
} from "../../core/ai/evidence-answer";
import type { AIAgentProfile } from "../../persistence/models/ai-agent-profile";

import {
  generateAIReply,
  resolveCoreAIAnswerability,
  type KnowledgeContextItem,
} from "./ai-chat-service";


const knowledgeContent = "Parking is available.";

const originalResponse = JSON.stringify({
  status: "full",
  answer: "Parking is free and available.",
  claims: [
    {
      text: "Parking is free and available.",
      chunk_id: "K1",
      quote: "Parking is available.",
    },
  ],
});

const correctedResponse = JSON.stringify({
  status: "full",
  answer: "Parking is available.",
  claims: [
    {
      text: "Parking is available.",
      chunk_id: "K1",
      quote: "Parking is available.",
    },
  ],
});

function makeResponse(
  text: string,
  provider: string,
): AIChatResponse {
  return {
    text,
    provider,
    model: "test-model",
    truncated: false,
  } as AIChatResponse;
}

test(
  "grounding retry uses and validates the corrected structured response",
  async () => {
    const evidenceSources = [
      {
        id: "K1",
        title: "Parking",
        sourceType: "rich_text",
        content: knowledgeContent,
      },
    ];

    // Confirm the first response passes structural evidence
    // verification so this test can exercise grounding retry.
    assert.equal(
      parseAndVerifyEvidenceAnswer(
        originalResponse,
        evidenceSources,
      ).valid,
      true,
    );

    assert.equal(
      parseAndVerifyEvidenceAnswer(
        correctedResponse,
        evidenceSources,
      ).valid,
      true,
    );

    let primaryCalls = 0;
    let fallbackCalls = 0;
    const requestTasks: string[] = [];
    let fallbackSystemPrompt = "";

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        requestTasks.push(request.task ?? "unspecified");

        return makeResponse(
          originalResponse,
          "cloudflare",
        );
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        requestTasks.push(request.task ?? "unspecified");
        fallbackSystemPrompt =
          request.messages[0]?.content ?? "";

        return makeResponse(
          correctedResponse,
          "gemini",
        );
      },
    };

    const knowledge: KnowledgeContextItem[] = [
      {
        title: "Parking",
        sourceType: "rich_text",
        content: knowledgeContent,
        score: 0.99,
        rerankScore: 0.99,
        matchedTerms: ["parking", "available"],
        titleMatch: true,
        intentMatch: true,
        exactPhraseMatch: true,
        retrievalMethod: "hybrid",
        rrfScore: 0.03,
        vectorRank: 1,
        lexicalRank: 1,
        lexicalScore: 0.99,
        rerankerScore: 0.99,
        rerankerRank: 1,
      },
    ];

    const message = {
      providerMessageId: "test-message-1",
      conversationId: "test-conversation-1",
      occurredAt: "2026-10-10T00:00:00.000Z",
      text: "Is parking available?",
    } as unknown as CanonicalInboundMessage;

    const profile = {
      tenantId: "test-tenant",
      businessName: "Test Business",
    } as unknown as AIAgentProfile;

    const reply = await generateAIReply(
      ai,
      [],
      message,
      profile,
      knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);

    // Both the original generation and grounding retry
    // must retain structured evidence-answer routing.
    assert.deepEqual(
      requestTasks,
      ["structured", "structured"],
    );

    // Confirm the fallback call is the grounding correction,
    // rather than the earlier incomplete-response retry.
    assert.match(
      fallbackSystemPrompt,
      /grounding check/i,
    );

    // The delivered reply must come from the corrected response,
    // not the original unsupported claim.
    assert.equal(reply, "Parking is available.");
    assert.doesNotMatch(reply, /\bfree\b/i);
  },
);


test(
  "grounding retry hands off when the corrected response remains unsupported",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const ai: AIProvider = {
      async chat() {
        primaryCalls += 1;
        return makeResponse(originalResponse, "cloudflare");
      },

      async chatFallback() {
        fallbackCalls += 1;

        // Simulate a correction that still claims parking is free.
        return makeResponse(originalResponse, "gemini");
      },
    };

    const knowledge: KnowledgeContextItem[] = [
      {
        title: "Parking",
        sourceType: "rich_text",
        content: knowledgeContent,
        score: 0.99,
        rerankScore: 0.99,
        matchedTerms: ["parking", "available"],
        titleMatch: true,
        intentMatch: true,
        exactPhraseMatch: true,
        retrievalMethod: "hybrid",
        rrfScore: 0.03,
        vectorRank: 1,
        lexicalRank: 1,
        lexicalScore: 0.99,
        rerankerScore: 0.99,
        rerankerRank: 1,
      },
    ];

    const message = {
      providerMessageId: "test-message-2",
      conversationId: "test-conversation-2",
      occurredAt: "2026-10-10T00:00:00.000Z",
      text: "Is parking available?",
    } as unknown as CanonicalInboundMessage;

    const profile = {
      tenantId: "test-tenant",
      businessName: "Test Business",
    } as unknown as AIAgentProfile;

    const reply = await generateAIReply(
      ai,
      [],
      message,
      profile,
      knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);

    // The unsupported claim must not reach the customer.
    assert.doesNotMatch(reply, /\bfree\b/i);

    // The application should return a controlled handoff offer.
    assert.match(reply, /pass your request to our team/i);
  },
);


function makeReplyFixture(messageId: string) {
  const conversationId = `conversation-${messageId}`;

  return {
    history: [],
    message: {
      providerMessageId: messageId,
      conversationId,
      occurredAt: "2026-10-10T00:00:00.000Z",
      text: "Is parking available?",
    } as unknown as CanonicalInboundMessage,
    profile: {
      tenantId: "test-tenant",
      businessName: "Test Business",
    } as unknown as AIAgentProfile,
    knowledge: [
      {
        title: "Parking",
        sourceType: "rich_text",
        content: knowledgeContent,
        score: 0.99,
        rerankScore: 0.99,
        matchedTerms: ["parking", "available"],
        titleMatch: true,
        intentMatch: true,
        exactPhraseMatch: true,
        retrievalMethod: "hybrid" as const,
        rrfScore: 0.03,
        vectorRank: 1,
        lexicalRank: 1,
        lexicalScore: 0.99,
        rerankerScore: 0.99,
        rerankerRank: 1,
      },
    ],
  };
}

test(
  "malformed structured output can recover through a valid fallback response",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const tasks: string[] = [];

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        tasks.push(request.task ?? "unspecified");
        return makeResponse("This is not valid JSON.", "cloudflare");
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        tasks.push(request.task ?? "unspecified");
        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture("malformed-structured");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(tasks, ["structured", "structured"]);
    assert.equal(reply, "Parking is available.");
  },
);

test(
  "structured generation recovers when the primary provider throws",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const ai: AIProvider = {
      async chat() {
        primaryCalls += 1;
        throw new Error("Internal provider failure");
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        assert.equal(request.task, "structured");
        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture("provider-error-recovery");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(reply, "Parking is available.");
    assert.doesNotMatch(reply, /Internal provider failure/i);
  },
);


test(
  "both provider failures return a safe customer fallback without retrying",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const primarySecret = "primary-sensitive-value";
    const fallbackSecret = "fallback-sensitive-value";

    const ai: AIProvider = {
      async chat() {
        primaryCalls += 1;
        throw new Error(
          `Primary provider failed; key=${primarySecret}`,
        );
      },

      async chatFallback(request) {
        fallbackCalls += 1;

        assert.equal(request.task, "structured");

        throw new Error(
          `Fallback provider failed; key=${fallbackSecret}`,
        );
      },
    };

    const fixture = makeReplyFixture("both-providers-failed");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);

    // The customer gets a controlled response, not an exception.
    assert.match(reply, /trouble checking that right now/i);
    assert.match(reply, /pass your request to the .* team/i);

    // Internal provider errors must not appear in the reply.
    assert.doesNotMatch(reply, /primary-sensitive-value/i);
    assert.doesNotMatch(reply, /fallback-sensitive-value/i);
    assert.doesNotMatch(reply, /Primary provider failed/i);
    assert.doesNotMatch(reply, /Fallback provider failed/i);
  },
);


test(
  "human takeover during grounding retry prevents AI delivery",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    let humanTakeover = false;
    let takeoverChecks = 0;

    const ai: AIProvider = {
      async chat() {
        primaryCalls += 1;

        // Structurally valid, but contains an unsupported claim.
        return makeResponse(originalResponse, "cloudflare");
      },

      async chatFallback(request) {
        fallbackCalls += 1;

        assert.equal(request.task, "structured");

        // Staff takes over while the corrective answer is generated.
        humanTakeover = true;

        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture("human-takeover-during-retry");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
      "",
      "",
      async () => {
        takeoverChecks += 1;
        return humanTakeover;
      },
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.ok(takeoverChecks >= 2);

    // The application must not return the AI-generated answer.
    assert.equal(reply, "");
  },
);


test(
  "rejects malformed structured output when both attempts fail verification",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const invalidPrimary = "This is not valid JSON.";
    const invalidFallback = "Still not valid JSON.";

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        assert.equal(request.task, "structured");

        return makeResponse(invalidPrimary, "cloudflare");
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        assert.equal(request.task, "structured");

        return makeResponse(invalidFallback, "gemini");
      },
    };

    const fixture = makeReplyFixture("malformed-both-attempts");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    // The initial attempt and one fallback correction only.
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);

    // Invalid raw model text must never reach the customer.
    assert.doesNotMatch(reply, /This is not valid JSON/i);
    assert.doesNotMatch(reply, /Still not valid JSON/i);

    // A controlled handoff is returned instead of accepting
    // an empty or malformed answer.
    assert.ok(reply.trim().length > 0);
    assert.match(reply, /pass your request to our team/i);
  },
);


test(
  "empty fallback response after malformed primary output returns controlled handoff",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        assert.equal(request.task, "structured");
        return makeResponse("This is not valid JSON.", "cloudflare");
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        assert.equal(request.task, "structured");
        return makeResponse("", "gemini");
      },
    };

    const fixture = makeReplyFixture(
      "malformed-primary-empty-fallback",
    );

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.ok(reply.trim().length > 0);
    assert.doesNotMatch(reply, /This is not valid JSON/i);
    assert.match(reply, /pass your request to our team/i);
  },
);
test(
  "valid structured no-answer response triggers controlled handoff",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const noAnswerResponse = JSON.stringify({
      status: "none",
      answer: "",
      claims: [],
    });

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        assert.equal(request.task, "structured");

        return makeResponse(noAnswerResponse, "cloudflare");
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        assert.equal(request.task, "structured");

        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture("validated-no-answer");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    // A valid no-answer result should hand off immediately,
    // not trigger a needless corrective generation.
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 0);

    assert.ok(reply.trim().length > 0);
    assert.match(reply, /pass your request to our team/i);

    // Internal sentinel and JSON must never reach the customer.
    assert.doesNotMatch(reply, /NO_MATCH/i);
    assert.doesNotMatch(reply, /"status"\s*:/i);
  },
);


test("answerability allows normal conversation without knowledge", () => {
  const result = resolveCoreAIAnswerability(
    false,
    false,
    "none",
    "none",
    false,
  );

  assert.equal(result.decision, "answer");
  assert.equal(result.confidence, "high");
  assert.equal(result.reason, "normal_conversation");
});

test("answerability hands off when approved knowledge is missing", () => {
  const result = resolveCoreAIAnswerability(
    true,
    false,
    "complete",
    "complete",
    false,
  );

  assert.equal(result.decision, "handoff");
  assert.equal(result.reason, "no_approved_knowledge");
});

test("answerability hands off when requested intent has no coverage", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "none",
    "complete",
    false,
  );

  assert.equal(result.decision, "handoff");
  assert.equal(result.reason, "no_requested_intent_coverage");
});

test("answerability hands off when requested attributes have no coverage", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "complete",
    "none",
    true,
  );

  assert.equal(result.decision, "handoff");
  assert.equal(result.reason, "no_requested_attribute_coverage");
});

test("answerability permits a partial answer for partial intent coverage", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "partial",
    "complete",
    false,
  );

  assert.equal(result.decision, "answer_partial");
  assert.equal(result.confidence, "medium");
  assert.equal(result.reason, "partial_knowledge_coverage");
});

test("answerability permits a partial answer for partially covered attributes", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "complete",
    "partial",
    true,
  );

  assert.equal(result.decision, "answer_partial");
  assert.equal(result.confidence, "medium");
  assert.equal(result.reason, "partial_knowledge_coverage");
});

test("answerability allows fully covered knowledge requests", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "complete",
    "complete",
    true,
  );

  assert.equal(result.decision, "answer");
  assert.equal(result.confidence, "high");
  assert.equal(result.reason, "complete_knowledge_coverage");
});



test(
  "grounding accepts supported facts from separate approved knowledge sources",
  async () => {
    const responseText = JSON.stringify({
      status: "full",
      answer: "We open at 9 AM. We close at 5 PM.",
      claims: [
        {
          text: "We open at 9 AM.",
          chunk_id: "K1",
          quote: "We open at 9 AM.",
        },
        {
          text: "We close at 5 PM.",
          chunk_id: "K2",
          quote: "We close at 5 PM.",
        },
      ],
    });

    let primaryCalls = 0;
    let fallbackCalls = 0;

    const ai: AIProvider = {
      async chat() {
        primaryCalls += 1;
        return makeResponse(responseText, "cloudflare");
      },

      async chatFallback() {
        fallbackCalls += 1;
        return makeResponse(responseText, "gemini");
      },
    };

    const knowledge: KnowledgeContextItem[] = [
      {
        title: "Opening time",
        sourceType: "rich_text",
        content: "We open at 9 AM.",
        score: 0.99,
        rerankScore: 0.99,
        matchedTerms: ["open", "9 AM"],
        titleMatch: true,
        intentMatch: true,
        exactPhraseMatch: true,
        retrievalMethod: "hybrid",
        rrfScore: 0.03,
        vectorRank: 1,
        lexicalRank: 1,
        lexicalScore: 0.99,
        rerankerScore: 0.99,
        rerankerRank: 1,
      },
      {
        title: "Closing time",
        sourceType: "rich_text",
        content: "We close at 5 PM.",
        score: 0.98,
        rerankScore: 0.98,
        matchedTerms: ["close", "5 PM"],
        titleMatch: true,
        intentMatch: true,
        exactPhraseMatch: true,
        retrievalMethod: "hybrid",
        rrfScore: 0.029,
        vectorRank: 2,
        lexicalRank: 2,
        lexicalScore: 0.98,
        rerankerScore: 0.98,
        rerankerRank: 2,
      },
    ];

    const message = {
      providerMessageId: "test-cross-source-message",
      conversationId: "test-cross-source-conversation",
      occurredAt: "2026-10-10T00:00:00.000Z",
      text: "What time do you open and close?",
    } as unknown as CanonicalInboundMessage;

    const profile = {
      tenantId: "test-tenant",
      businessName: "Test Business",
    } as unknown as AIAgentProfile;

    const reply = await generateAIReply(
      ai,
      [],
      message,
      profile,
      knowledge,
    );

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 0);
    assert.match(reply, /9 AM/i);
    assert.match(reply, /5 PM/i);
  },
);


import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalInboundMessage } from "../../canonical/message";
import type {
  AIChatResponse,
  AIProvider,
} from "../../core/ai";
import { HybridAIProvider } from "../../core/ai/providers/hybrid";
import {
  parseAndVerifyEvidenceAnswer,
} from "../../core/ai/evidence-answer";
import type { AIAgentProfile } from "../../persistence/models/ai-agent-profile";

import {
  generateAIReply,
  resolveCoreAIAnswerability,
  rewriteKnowledgeQuery,
  type KnowledgeContextItem,
} from "./ai-chat-service";

import type { MessagingMessage } from "../../core/messaging";
import { resolveKnowledgeQuery } from "./knowledge-query-context";
import { selectKnowledgeForAnswer } from "./knowledge-intelligence";



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
    const groundingDiagnostics: string[] = [];
    const originalConsoleLog = console.log;
    console.log = ((...args: unknown[]) => {
      if (String(args[0]).includes("GROUNDING") || String(args[0]) === "AI TRACE") {
        groundingDiagnostics.push(JSON.stringify(args));
      }
    }) as typeof console.log;

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

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        [],
        message,
        profile,
        knowledge,
      );
    } finally {
      console.log = originalConsoleLog;
    }

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
    assert.doesNotMatch(groundingDiagnostics.join(" "), /\bfree\b/i);
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



function makeReplyFixture(
  messageId: string,
  history: MessagingMessage[] = [],
  messageText = "Is parking available?",
) {
  const conversationId = `conversation-${messageId}`;

  return {
    history,
    message: {
      providerMessageId: messageId,
      conversationId,
      occurredAt: "2026-10-10T00:00:00.000Z",
      text: messageText,
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

function makeHistoryMessage(
  id: string,
  conversationId: string,
  senderType: "customer" | "ai" | "human",
  text: string,
  timestamp: string,
): MessagingMessage {
  return {
    id,
    conversationId,
    contactId: "test-contact",
    direction:
      senderType === "customer" ? "inbound" : "outbound",
    senderType,
    text,
    timestamp,
  } as unknown as MessagingMessage;
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
  "an already active human takeover prevents model generation",
  async () => {
    let providerCalls = 0;
    const ai: AIProvider = {
      async chat() {
        providerCalls += 1;
        return makeResponse(correctedResponse, "cloudflare");
      },
      async chatFallback() {
        providerCalls += 1;
        return makeResponse(correctedResponse, "gemini");
      },
    };
    const fixture = makeReplyFixture("human-takeover-before-generation");

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
      "",
      "",
      async () => true,
    );

    assert.equal(reply, "");
    assert.equal(providerCalls, 0);
  },
);

test(
  "human takeover detected after provider failure suppresses fallback delivery",
  async () => {
    let takeover = false;
    let takeoverChecks = 0;
    let fallbackCalls = 0;
    const ai: AIProvider = {
      async chat() {
        takeover = true;
        throw new Error("Simulated provider failure");
      },
      async chatFallback() {
        fallbackCalls += 1;
        throw new Error("Simulated fallback provider failure");
      },
    };
    const fixture = makeReplyFixture("human-takeover-during-provider-failure");

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
        return takeover;
      },
    );

    assert.equal(reply, "");
    assert.equal(takeoverChecks, 2);
    assert.equal(fallbackCalls, 1);
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

test("a clarified branch contact request still uses existing no-knowledge safeguards when evidence is absent", () => {
  const resolved = resolveKnowledgeQuery(
    "Kota Kemuning",
    [
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.",
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    "2026-10-11T15:01:00.000Z",
  );

  assert.equal(resolved.clarificationResolved, true);

  const answerability = resolveCoreAIAnswerability(
    true,
    false,
    "none",
    "none",
    true,
  );

  assert.equal(answerability.decision, "handoff");
  assert.equal(answerability.reason, "no_approved_knowledge");
});

test("resolved branch and contact attribute reach existing candidate selection diagnostics", () => {
  const resolved = resolveKnowledgeQuery(
    "the earlier branch",
    [
      {
        role: "customer",
        text: "Can I get Kota Kemuning address?",
        timestamp: "2026-10-11T15:00:00.000Z",
      },
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.",
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    "2026-10-11T15:01:00.000Z",
  );

  assert.equal(resolved.clarificationResolved, true);
  const weakCandidate: KnowledgeContextItem = {
    title: "Kota Kemuning branch contact details",
    sourceType: "rich_text",
    content: "Kota Kemuning branch contact number is 03-1234 5678.",
    score: 0.2,
    retrievalMethod: "hybrid",
  };
  const selection = selectKnowledgeForAnswer(
    resolved.retrievalQuery,
    [weakCandidate],
    resolved.analysisQuery,
  );

  assert.ok(selection.analysis.terms.includes("kota"));
  assert.ok(selection.analysis.terms.includes("contact"));
  assert.ok(selection.analysis.intents.includes("contact"));
  assert.ok(
    selection.attributeCoverage.requested.some(
      (requirement) => requirement.intent === "contact",
    ),
  );
  assert.ok(selection.candidateDiagnostics.length > 0);
  assert.equal(selection.candidateDiagnostics[0]?.decision, "rejected");
  assert.equal(
    selection.candidateDiagnostics[0]?.rejectionReason,
    "normal_eligibility_rules_not_satisfied",
  );
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

test("answerability allows a partial response when relevant approved knowledge lacks the exact requested attribute", () => {
  const result = resolveCoreAIAnswerability(
    true,
    true,
    "complete",
    "none",
    true,
  );

  assert.equal(result.decision, "answer_partial");
  assert.equal(result.confidence, "medium");
  assert.equal(result.reason, "partial_knowledge_coverage");
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


function makeQueryRewriteProvider(
  responseText: string,
): Parameters<typeof rewriteKnowledgeQuery>[0] {
  return {
    chat: async () => ({
      text: responseText,
    }),
  } as unknown as Parameters<
    typeof rewriteKnowledgeQuery
  >[0];
}

test(
  "query rewriting returns a standalone business search query",
  async () => {
    const result = await rewriteKnowledgeQuery(
      makeQueryRewriteProvider(
        "What is the address of the Alam Impian branch?",
      ),
      "Hi, want to know Alam Impian address",
      "What is the address of Alam Impian branch?",
    );

    assert.equal(result.rewritten, true);
    assert.equal(result.reason, "rewritten");
    assert.equal(
      result.query,
      "What is the address of the Alam Impian branch?",
    );
  },
);

test("query rewrite wraps the real LLM request in privacy-safe lifecycle checkpoints", async () => {
  const privateQuery = "PRIVATE_CUSTOMER_QUERY customer@example.test";
  const entries: unknown[][] = [];
  const originalConsoleInfo = console.info;
  console.info = (...args: unknown[]) => entries.push(args);

  try {
    await rewriteKnowledgeQuery(
      makeQueryRewriteProvider("A safe rewritten query"),
      privateQuery,
      privateQuery,
      "ghl-in-query-test",
    );
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.deepEqual(entries.map((entry) => (entry[1] as { operation: string; phase: string }).operation + ":" + (entry[1] as { phase: string }).phase), [
    "llm_request:start",
    "llm_request:complete",
  ]);
  assert.equal(JSON.stringify(entries).includes(privateQuery), false);
  assert.equal(JSON.stringify(entries).includes("A safe rewritten query"), false);
});

test(
  "query rewriting returns the contextual fallback on empty output",
  async () => {
    const contextualQuery =
      "What is the address of the Alam Impian branch?";

    const result = await rewriteKnowledgeQuery(
      makeQueryRewriteProvider(""),
      "What about its address?",
      contextualQuery,
    );

    assert.equal(result.rewritten, false);
    assert.equal(result.reason, "empty_response");
    assert.equal(result.query, contextualQuery);
  },
);

test(
  "query rewriting rejects newly introduced numbers",
  async () => {
    const contextualQuery =
      "What is the phone number 12345678?";

    const result = await rewriteKnowledgeQuery(
      makeQueryRewriteProvider(
        "What is the phone number 98765432?",
      ),
      contextualQuery,
      contextualQuery,
    );

    assert.equal(result.rewritten, false);
    assert.equal(result.reason, "numeric_guard");
    assert.equal(result.query, contextualQuery);
  },
);

test(
  "query rewriting returns the contextual fallback on provider failure",
  async () => {
    const contextualQuery =
      "What is the address of the Alam Impian branch?";

    const ai = {
      chat: async () => {
        throw new Error("Simulated provider failure");
      },
    } as unknown as Parameters<
      typeof rewriteKnowledgeQuery
    >[0];

    const result = await rewriteKnowledgeQuery(
      ai,
      "What about the address?",
      contextualQuery,
    );

    assert.equal(result.rewritten, false);
    assert.equal(result.reason, "provider_error");
    assert.equal(result.query, contextualQuery);
  },
);

test("query rewrite diagnostics retain safe provider failure categories after aggregation", async () => {
  const privateDetails = "PRIVATE_PROVIDER_BODY_AND_PROMPT";
  const ai = new HybridAIProvider(
    {
      async chat() {
        throw new TypeError(privateDetails);
      },
    },
    {
      async chat() {
        throw new TypeError(privateDetails);
      },
    },
  );
  const contextualQuery = "What are the Northside branch opening hours?";
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    const result = await rewriteKnowledgeQuery(
      ai,
      "What about Sunday?",
      contextualQuery,
    );

    assert.equal(result.reason, "provider_error");
    assert.equal(result.query, contextualQuery);
  } finally {
    console.warn = originalWarn;
  }

  const rewriteWarning = warnings.find(([message]) =>
    message === "AI knowledge query rewrite failed; using contextual query.",
  );
  assert.ok(rewriteWarning);
  const diagnostic = rewriteWarning[1] as {
    providerAttempts: Array<{ provider: string; outcome: string; failureKind?: string }>;
  };
  assert.deepEqual(diagnostic.providerAttempts.map(({ provider, outcome, failureKind }) => ({
    provider,
    outcome,
    failureKind,
  })), [
    { provider: "gemini", outcome: "error", failureKind: "type_error" },
    { provider: "cloudflare-workers-ai", outcome: "error", failureKind: "type_error" },
  ]);
  assert.equal(JSON.stringify(warnings).includes(privateDetails), false);
  assert.equal(JSON.stringify(warnings).includes("What about Sunday?"), false);
  assert.equal(JSON.stringify(warnings).includes(contextualQuery), false);
});

test(
  "query rewriting handles empty input without calling the provider",
  async () => {
    let providerCalls = 0;

    const ai = {
      chat: async () => {
        providerCalls += 1;
        return { text: "Unexpected response" };
      },
    } as unknown as Parameters<
      typeof rewriteKnowledgeQuery
    >[0];

    const result = await rewriteKnowledgeQuery(
      ai,
      "",
      "",
    );

    assert.equal(result.rewritten, false);
    assert.equal(result.reason, "empty_query");
    assert.equal(result.query, "");
    assert.equal(providerCalls, 0);
  },
);


test(
  "truncated primary response recovers through a valid fallback response",
  async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const requestedTokenLimits: number[] = [];
    const loggedEvents: string[] = [];
    const originalConsoleLog = console.log;
    console.log = ((event: unknown) => {
      loggedEvents.push(String(event));
    }) as typeof console.log;

    const ai: AIProvider = {
      async chat(request) {
        primaryCalls += 1;
        assert.equal(request.task, "structured");
        requestedTokenLimits.push(request.maxTokens ?? 0);

        return {
          ...makeResponse("", "cloudflare"),
          truncated: true,
          finishReason: "length",
        };
      },

      async chatFallback(request) {
        fallbackCalls += 1;
        assert.equal(request.task, "structured");
        requestedTokenLimits.push(request.maxTokens ?? 0);

        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture(
      "truncated-primary-valid-fallback",
    );

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        fixture.knowledge,
      );
    } finally {
      console.log = originalConsoleLog;
    }

    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(requestedTokenLimits, [768, 1024]);
    assert.ok(loggedEvents.includes("AI GENERATION INCOMPLETE"));
    assert.ok(!loggedEvents.includes("AI GENERATION SUCCESS"));
    assert.match(reply, /Parking is available/i);
    assert.doesNotMatch(
      reply,
      /pass your request to our team/i,
    );
    assert.doesNotMatch(reply, /"status"\s*:/i);
},
);

test(
  "hybrid provider keeps its fallback receiver while recovering truncated structured output",
  async () => {
    const fixture = makeReplyFixture("hybrid-truncated-structured");
    const outputLimits: number[] = [];
    let fallbackCalls = 0;
    const hybrid = new HybridAIProvider(
      {
        async chat(request) {
          outputLimits.push(request.maxTokens ?? 0);
          return {
            ...makeResponse("", "cloudflare"),
            finishReason: "length",
            truncated: true,
          };
        },
      },
      {
        async chat(request) {
          fallbackCalls += 1;
          outputLimits.push(request.maxTokens ?? 0);
          assert.equal(request.task, "structured");
          return makeResponse(correctedResponse, "gemini");
        },
      },
    );

    const reply = await generateAIReply(
      hybrid,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(reply, "Parking is available.");
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(outputLimits, [768, 1024]);
  },
);

test(
  "empty structured response rejection followed by fallback failure safely hands off",
  async () => {
    const fixture = makeReplyFixture("hybrid-empty-retry-failure");
    let fallbackCalls = 0;
    const warnings: unknown[][] = [];
    const originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    const hybrid = new HybridAIProvider(
      {
        async chat() {
          return makeResponse("", "cloudflare");
        },
      },
      {
        async chat() {
          fallbackCalls += 1;
          throw new Error("fallback unavailable");
        },
      },
    );

    let reply: string;
    try {
      reply = await generateAIReply(
        hybrid,
        fixture.history,
        fixture.message,
        fixture.profile,
        fixture.knowledge,
      );
    } finally {
      console.warn = originalConsoleWarn;
    }

    assert.equal(fallbackCalls, 1);
    assert.equal(
      warnings.some(
        ([event, details]) =>
          event === "AI STRUCTURED EVIDENCE ANSWER REJECTED" &&
          (details as { reason?: string }).reason === "empty_structured_response",
      ),
      true,
    );
    assert.match(reply, /pass your request to our team/i);
    assert.doesNotMatch(reply, /Parking is available\./);
  },
);

test(
  "waits for delayed structured generation before returning the answer",
  async () => {
    const fixture = makeReplyFixture("delayed-structured-generation");
    let releaseGeneration!: (response: AIChatResponse) => void;
    let generationReturned = false;
    const ai: AIProvider = {
      chat: () => new Promise<AIChatResponse>((resolve) => {
        releaseGeneration = resolve;
      }),
    };

    const answerPromise = generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    ).then((answer) => {
      generationReturned = true;
      return answer;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(generationReturned, false);

    releaseGeneration(makeResponse(correctedResponse, "cloudflare"));

    assert.equal(await answerPromise, "Parking is available.");
    assert.equal(generationReturned, true);
  },
);


test(
  "AI identity question gets a specific answer without calling the model",
  async () => {
    let providerCalls = 0;

    const ai: AIProvider = {
      async chat() {
        providerCalls += 1;
        return makeResponse(correctedResponse, "cloudflare");
      },
      async chatFallback() {
        providerCalls += 1;
        return makeResponse(correctedResponse, "gemini");
      },
    };

    const fixture = makeReplyFixture(
      "identity-question",
      [],
      "Hello, am I talking to AI?",
    );

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(providerCalls, 0);
    assert.match(reply, /virtual assistant/i);
    assert.match(reply, /Test Business/i);
  },
);

test(
  "existing conversations suppress a recognized opening greeting and keep the answer",
  async () => {
    const fixture = makeReplyFixture(
      "greeting-existing",
      [
        makeHistoryMessage(
          "prior-assistant-reply",
          "conversation-greeting-existing",
          "ai",
          "I can help with your questions.",
          "2026-10-09T23:59:00.000Z",
        ),
      ],
      "Thanks!",
    );
    const ai: AIProvider = {
      async chat() {
        return makeResponse("Hello! You're welcome.", "cloudflare");
      },
      async chatFallback() {
        throw new Error("Fallback should not be called");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      [],
    );

    assert.equal(reply, "You're welcome.");
    assert.doesNotMatch(reply, /^(?:hi|hello|hey)\b/i);
  },
);

test(
  "new conversations preserve a legitimate opening greeting",
  async () => {
    const fixture = makeReplyFixture(
      "greeting-new",
      [],
      "Thanks!",
    );
    const ai: AIProvider = {
      async chat() {
        return makeResponse("Hello! You're welcome.", "cloudflare");
      },
      async chatFallback() {
        throw new Error("Fallback should not be called");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      [],
    );

    assert.equal(reply, "Hello! You're welcome.");
  },
);

test(
  "provider failure fallback does not add a redundant opening greeting",
  async () => {
    const fixture = makeReplyFixture(
      "greeting-provider-failure",
      [
        makeHistoryMessage(
          "prior-assistant-reply-fallback",
          "conversation-greeting-provider-failure",
          "ai",
          "I can help with your questions.",
          "2026-10-09T23:59:00.000Z",
        ),
      ],
      "Thanks!",
    );
    const ai: AIProvider = {
      async chat() {
        throw new Error("Simulated provider failure");
      },
      async chatFallback() {
        throw new Error("Simulated fallback failure");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      [],
    );

    assert.match(reply, /having a little trouble/i);
    assert.doesNotMatch(reply, /^(?:hi|hello|hey)\b/i);
  },
);

test(
  "recognized handoff offers are not rewritten by greeting suppression",
  async () => {
    const fixture = makeReplyFixture(
      "greeting-handoff",
      [
        makeHistoryMessage(
          "prior-assistant-reply-handoff",
          "conversation-greeting-handoff",
          "ai",
          "I can help with your questions.",
          "2026-10-09T23:59:00.000Z",
        ),
      ],
      "Thanks!",
    );
    const handoffOffer = "Hello! I can pass your request to our team for confirmation. Would you like me to?";
    const ai: AIProvider = {
      async chat() {
        return makeResponse(handoffOffer, "cloudflare");
      },
      async chatFallback() {
        throw new Error("Fallback should not be called");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      [],
    );

    assert.equal(reply, handoffOffer);
  },
);

test(
  "conversation history preserves AI identity and customer feedback",
  async () => {
    const conversationId = "conversation-history-context";

    const history = [
      makeHistoryMessage(
        "history-greeting",
        conversationId,
        "ai",
        "Hello! How can I help today?",
        "2026-10-09T23:55:00.000Z",
      ),
      makeHistoryMessage(
        "history-1",
        conversationId,
        "customer",
        "Are you an AI?",
        "2026-10-09T23:56:00.000Z",
      ),
      makeHistoryMessage(
        "history-2",
        conversationId,
        "ai",
        "I'm Test Business's virtual assistant.",
        "2026-10-09T23:57:00.000Z",
      ),
      makeHistoryMessage(
        "history-3",
        conversationId,
        "customer",
        "You keep repeating yourself.",
        "2026-10-09T23:58:00.000Z",
      ),
      makeHistoryMessage(
        "history-4",
        conversationId,
        "ai",
        "Sorry about that. I'll keep my replies focused.",
        "2026-10-09T23:59:00.000Z",
      ),
      makeHistoryMessage(
        "history-human",
        conversationId,
        "human",
        "Our clinic team can help if you need anything else.",
        "2026-10-09T23:59:30.000Z",
      ),
    ].reverse();

    const fixture = makeReplyFixture(
      "history-context",
      history,
      "Is parking available?",
    );

    let capturedRequestText = "";

    const capture = (
      request: { messages: Array<{ content: string }> },
    ) => {
      capturedRequestText = request.messages
        .map((item) => item.content)
        .join("\n");
    };

    const ai: AIProvider = {
      async chat(request) {
        capture(request);
        return makeResponse(correctedResponse, "cloudflare");
      },
      async chatFallback(request) {
        capture(request);
        return makeResponse(correctedResponse, "gemini");
            },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(reply, "Parking is available.");

    const priorGreeting = capturedRequestText.indexOf(
      "Hello! How can I help today?",
    );
    const identityQuestion = capturedRequestText.indexOf(
      "Are you an AI?",
    );
    const identityAnswer = capturedRequestText.indexOf(
      "I'm Test Business's virtual assistant.",
    );
    const customerFeedback = capturedRequestText.indexOf(
      "You keep repeating yourself.",
    );
    const acknowledgement = capturedRequestText.indexOf(
      "Sorry about that. I'll keep my replies focused.",
    );
    const staffMessage = capturedRequestText.indexOf(
      "(sent by our staff) Our clinic team can help if you need anything else.",
    );

    assert.ok(priorGreeting >= 0, "the prior greeting must reach the model");
    assert.ok(identityQuestion > priorGreeting, "history must be ordered chronologically");
    assert.ok(identityAnswer > identityQuestion, "identity answer must follow the question");
    assert.ok(customerFeedback > identityAnswer, "customer feedback must be retained");
    assert.ok(acknowledgement > customerFeedback, "the acknowledgement must be retained");
    assert.ok(staffMessage > acknowledgement, "the human-authored message must remain clearly labeled and ordered");
    assert.match(capturedRequestText, /Do not greet again/i);
  },
);

test(
  "declined handoff is not repeated after the customer asks a new question",
  async () => {
    const conversationId = "conversation-declined-handoff";

    const history = [
      makeHistoryMessage(
        "handoff-offer",
        conversationId,
        "ai",
        "I can pass your request to our team for confirmation. Would you like me to?",
        "2026-10-09T23:56:00.000Z",
      ),
      makeHistoryMessage(
        "handoff-decline",
        conversationId,
        "customer",
        "No, thanks.",
        "2026-10-09T23:57:00.000Z",
      ),
      makeHistoryMessage(
        "handoff-ack",
        conversationId,
        "ai",
        "Understood. I'll keep helping with your questions.",
        "2026-10-09T23:58:00.000Z",
      ),
    ];

    const fixture = makeReplyFixture(
      "declined-handoff",
      history,
      "Is parking available?",
    );

    const ai: AIProvider = {
      async chat() {
        throw new Error("Simulated provider failure");
      },
      async chatFallback() {
        throw new Error("Simulated fallback failure");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.match(reply, /can't confirm/i);
    assert.doesNotMatch(
      reply,
      /pass your request to our team|would you like me to/i,
    );
  },
);

test(

  "selected branch evidence reaches the model context and final trace even when short-query policy says conversation",
  async () => {
    const fixture = makeReplyFixture(
      "selected-branch-context",
      [],
      "Kota Kemuning",
    );
    const branchEvidence: KnowledgeContextItem = {
      id: "branch-chunk-1",
      knowledgeSourceId: "branch-source-1",
      providerDocumentId: "branch-document-1",
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content:
        "Kota Kemuning branch address: 12 Jalan Anggerik, Kota Kemuning.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };
    const unrelatedEvidence: KnowledgeContextItem = {
      ...branchEvidence,
      id: "unrelated-chunk-1",
      knowledgeSourceId: "unrelated-source-1",
      providerDocumentId: "unrelated-document-1",
      title: "Shah Alam Branch Information",
      content: "Shah Alam branch address: 9 Jalan Utama, Shah Alam.",
      score: 0.2,
      rerankerScore: 0.1,
    };
    let capturedSystemPrompt = "";
    let trace: { retrieval?: { selectedCount?: number } } | undefined;
    const originalConsoleLog = console.log;
    console.log = ((...args: unknown[]) => {
      if (args[0] === "AI TRACE") {
        trace = args[1] as { retrieval?: { selectedCount?: number } };
      }
    }) as typeof console.log;

    const ai: AIProvider = {
      async chat(request) {
        capturedSystemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(
          "The Kota Kemuning branch is at 12 Jalan Anggerik, Kota Kemuning.",
          "cloudflare",
        );
      },
    };

    try {
      await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [branchEvidence, unrelatedEvidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    assert.match(capturedSystemPrompt, /12 Jalan Anggerik/);
    assert.doesNotMatch(capturedSystemPrompt, /9 Jalan Utama/);
    assert.equal(trace?.retrieval?.selectedCount, 1);
  },
);

test(

  "answers normally without repeating handoff after the customer declines",
  async () => {
    const conversationId = "conversation-declined-handoff-success";

    const history = [
      makeHistoryMessage(
        "handoff-offer-success",
        conversationId,
        "ai",
        "I can pass your request to our team for confirmation. Would you like me to?",
        "2026-10-09T23:56:00.000Z",
      ),
      makeHistoryMessage(
        "handoff-decline-success",
        conversationId,
        "customer",
        "No, thanks.",
        "2026-10-09T23:57:00.000Z",
      ),
      makeHistoryMessage(
        "handoff-ack-success",
        conversationId,
        "ai",
        "Understood. I'll keep helping with your questions.",
        "2026-10-09T23:58:00.000Z",
      ),
    ];

    const fixture = makeReplyFixture(
      "declined-handoff-success",
      history,
      "Is parking available?",
    );

    const ai: AIProvider = {
      async chat() {
        return makeResponse(correctedResponse, "cloudflare");
      },
      async chatFallback() {
        return makeResponse(correctedResponse, "gemini");
      },
    };

    const reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );

    assert.equal(reply, "Parking is available.");
    assert.doesNotMatch(
      reply,
      /pass your request to our team|would you like me to/i,
    );
  },
);

test(
  "contextual address selection reaches the model and produces a grounded answer without no-knowledge handoff",
  async () => {
    const fixture = makeReplyFixture(
      "contextual-address-answer",
      [],
      "Can I know the address?",
    );
    const branchConversation = [
      makeHistoryMessage(
        "prior-kota-kemuning-topic",
        fixture.message.conversationId,
        "customer",
        "Can you tell me the address for Kota Kemuning branch?",
        "2026-10-09T23:59:00.000Z",
      ),
    ];
    const branchEvidence: KnowledgeContextItem = {
      id: "kota-kemuning-address-chunk",
      knowledgeSourceId: "kota-kemuning-source",
      providerDocumentId: "kota-kemuning-document",
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content:
        "Kota Kemuning branch address: 12 Jalan Anggerik, Kota Kemuning.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };
    const unrelatedEvidence: KnowledgeContextItem = {
      ...branchEvidence,
      id: "shah-alam-address-chunk",
      knowledgeSourceId: "shah-alam-source",
      providerDocumentId: "shah-alam-document",
      title: "Shah Alam Branch Information",
      content: "Shah Alam branch address: 9 Jalan Utama, Shah Alam.",
      score: 0.12,
      rerankerScore: 0.1,
    };
    const evidenceAnswer = JSON.stringify({
      status: "full",
      answer: "The address is 12 Jalan Anggerik, Kota Kemuning.",
      claims: [
        {
          text: "The address is 12 Jalan Anggerik, Kota Kemuning.",
          chunk_id: "K1",
          quote: "Kota Kemuning branch address: 12 Jalan Anggerik, Kota Kemuning.",
        },
      ],
    });
    const logEntries: unknown[][] = [];
    let capturedSystemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logEntries.push(args);

    const ai: AIProvider = {
      async chat(request) {
        capturedSystemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(evidenceAnswer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        branchConversation,
        fixture.message,
        fixture.profile,
        [branchEvidence, unrelatedEvidence],
        "",
        "",
        undefined,
        "",
        undefined,
        {
          id: "version-test-123",
          tag: "staging",
          timestamp: "2026-10-14T00:00:00.000Z",
        },
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policyLog = logEntries.find(
      (entry) => entry[0] === "AI RESPONSE POLICY",
    )?.[1] as {
      mode?: string;
      selectedSourceKeys?: string[];
      workerVersionId?: string;
      workerVersionTag?: string;
      workerVersionTimestamp?: string;
    } | undefined;
    const trace = logEntries.find(
      (entry) => entry[0] === "AI TRACE",
    )?.[1] as {
      retrieval?: {
        selectedCount?: number;
        knowledgeCoverageStatus?: string;
      };
      answerability?: { decision?: string };
      workerVersion?: { id?: string; tag?: string; timestamp?: string };
    } | undefined;

    assert.match(capturedSystemPrompt, /12 Jalan Anggerik/);
    assert.doesNotMatch(capturedSystemPrompt, /9 Jalan Utama/);
    assert.equal(policyLog?.mode, "business_knowledge");
    assert.equal(policyLog?.workerVersionId, "version-test-123");
    assert.equal(policyLog?.workerVersionTag, "staging");
    assert.equal(policyLog?.workerVersionTimestamp, "2026-10-14T00:00:00.000Z");
    assert.deepEqual(trace?.workerVersion, {
      id: "version-test-123",
      tag: "staging",
      timestamp: "2026-10-14T00:00:00.000Z",
    });
    assert.deepEqual(policyLog?.selectedSourceKeys, ["kota-kemuning-document"]);
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(
      logEntries.some(
        (entry) => entry[0] === "AI HANDOFF" &&
          (entry[1] as { reason?: string }).reason === "no_knowledge",
      ),
      false,
    );
    assert.equal(reply, "The address is 12 Jalan Anggerik, Kota Kemuning.");
    const handoff = logEntries.find(
      (entry) => entry[0] === "AI KNOWLEDGE SELECTOR HANDOFF",
    )?.[1] as { workerVersionId?: string } | undefined;
    const selection = logEntries.find(
      (entry) => entry[0] === "AI KNOWLEDGE SELECTION DIAGNOSTICS",
    )?.[1] as { workerVersionId?: string } | undefined;
    assert.equal(handoff?.workerVersionId, "version-test-123");
    assert.equal(selection?.workerVersionId, "version-test-123");
    const serializedDiagnostics = JSON.stringify(logEntries);
    assert.equal(serializedDiagnostics.includes(fixture.message.text), false);
    assert.equal(serializedDiagnostics.includes(branchEvidence.content), false);
  },
);

test("AI diagnostics tolerate unavailable Worker version metadata without changing conversational behavior", async () => {
  const fixture = makeReplyFixture("missing-worker-version", [], "Hello");
  const logEntries: unknown[][] = [];
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => logEntries.push(args);
  const ai: AIProvider = {
    async chat() {
      return makeResponse("Hello! How can I help?", "cloudflare");
    },
  };
  let reply: string;
  try {
    reply = await generateAIReply(
      ai,
      fixture.history,
      fixture.message,
      fixture.profile,
      fixture.knowledge,
    );
  } finally {
    console.log = originalConsoleLog;
  }
  const trace = logEntries.find((entry) => entry[0] === "AI TRACE")?.[1] as {
    workerVersion?: unknown;
  } | undefined;
  const policy = logEntries.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
    workerVersionId?: string;
  } | undefined;
  assert.equal(reply, "Hello! How can I help?");
  assert.equal(trace?.workerVersion, undefined);
  assert.equal(policy?.workerVersionId, undefined);
});

test(
  "resolved branch clarification selects only documented contact evidence and aligns prompt, policy, answerability, grounding, and trace",
  async () => {
    const fixture = makeReplyFixture(
      "resolved-contact-follow-up",
      [],
      "the earlier branch",
    );
    const history = [
      makeHistoryMessage(
        "prior-branch-address-request",
        fixture.message.conversationId,
        "customer",
        "Can I get Kota Kemuning address?",
        "2026-10-09T23:57:00.000Z",
      ),
      makeHistoryMessage(
        "prior-contact-request",
        fixture.message.conversationId,
        "customer",
        "What is your contact number?",
        "2026-10-09T23:58:00.000Z",
      ),
      makeHistoryMessage(
        "contact-clarification",
        fixture.message.conversationId,
        "ai",
        "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.",
        "2026-10-09T23:59:00.000Z",
      ),
    ];
    const resolved = resolveKnowledgeQuery(
      fixture.message.text,
      history.map((item) => ({
        role: item.senderType === "customer" ? "customer" as const : "ai" as const,
        text: item.text,
        timestamp: item.timestamp,
      })),
      "2026-10-10T00:00:00.000Z",
    );
    assert.equal(resolved.contextSource, "resolved_branch_clarification");

    const contactEvidence: KnowledgeContextItem = {
      id: "kota-contact-chunk",
      knowledgeSourceId: "kota-contact-source",
      providerDocumentId: "kota-contact-document",
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content: "Kota Kemuning branch contact number: +60 3-1234 5678.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };
    const anotherBranchEvidence: KnowledgeContextItem = {
      ...contactEvidence,
      id: "shah-alam-contact-chunk",
      knowledgeSourceId: "shah-alam-contact-source",
      providerDocumentId: "shah-alam-contact-document",
      title: "Shah Alam Branch Information",
      content: "Shah Alam branch contact number: +60 3-7654 3210.",
      score: 0.12,
      rerankerScore: 0.1,
    };
    const evidenceAnswer = JSON.stringify({
      status: "full",
      answer: "The contact number for Kota Kemuning branch is +60 3-1234 5678.",
      claims: [
        {
          text: "The contact number for Kota Kemuning branch is +60 3-1234 5678.",
          chunk_id: "K1",
          quote: "Kota Kemuning branch contact number: +60 3-1234 5678.",
        },
      ],
    });
    const logs: unknown[][] = [];
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(evidenceAnswer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        history,
        fixture.message,
        fixture.profile,
        [contactEvidence, anotherBranchEvidence],
        "",
        resolved.retrievalQuery,
        undefined,
        resolved.analysisQuery ?? "",
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverage?: { covered?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
      requestedAttributesSupportedBySelectedEvidence?: boolean;
      selectorAnswerabilityConsistent?: boolean;
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
      stages?: Array<{ stage: string; details?: Record<string, unknown> }>;
    } | undefined;
    const handoff = logs.find((entry) => entry[0] === "AI KNOWLEDGE SELECTOR HANDOFF")?.[1] as {
      contextSourceKind?: string;
      contextualResolutionSucceeded?: boolean;
      resolvedEntityAvailable?: boolean;
      resolvedRetrievalQueryPresent?: boolean;
      resolvedRetrievalQueryLength?: number;
      resolvedAnalysisQueryPresent?: boolean;
      resolvedAnalysisQueryLength?: number;
      selectorRetrievalQueryPresent?: boolean;
      selectorRetrievalQueryLength?: number;
      selectorAnalysisQueryPresent?: boolean;
      selectorAnalysisQueryLength?: number;
      resolvedEntityTermCount?: number;
      selectorEntityTermCount?: number;
      sharedEntityTermCount?: number;
      resolvedEntityPreserved?: boolean;
    } | undefined;
    const selectionDiagnostic = logs.find(
      (entry) => entry[0] === "AI KNOWLEDGE SELECTION DIAGNOSTICS",
    )?.[1] as { candidates?: Array<{ entityMatch?: boolean; requestedAttributeSupport?: Array<{ supported: boolean }> }> } | undefined;
    const retrievalStage = trace?.stages?.find((stage) => stage.stage === "retrieval")?.details;

    assert.equal(handoff?.contextSourceKind, "resolved_branch_clarification");
    assert.equal(handoff?.contextualResolutionSucceeded, true);
    assert.equal(handoff?.resolvedEntityAvailable, true);
    assert.equal(handoff?.resolvedRetrievalQueryPresent, true);
    assert.ok((handoff?.resolvedRetrievalQueryLength ?? 0) > 0);
    assert.equal(handoff?.resolvedAnalysisQueryPresent, true);
    assert.ok((handoff?.resolvedAnalysisQueryLength ?? 0) > 0);
    assert.equal(handoff?.selectorRetrievalQueryPresent, true);
    assert.equal(handoff?.selectorAnalysisQueryPresent, true);
    assert.ok((handoff?.selectorAnalysisQueryLength ?? 0) > 0);
    assert.ok((handoff?.resolvedEntityTermCount ?? 0) > 0);
    assert.equal(handoff?.selectorEntityTermCount, handoff?.resolvedEntityTermCount);
    assert.equal(handoff?.sharedEntityTermCount, handoff?.resolvedEntityTermCount);
    assert.equal(handoff?.resolvedEntityPreserved, true);
    assert.match(systemPrompt, /\+60 3-1234 5678/);
    assert.doesNotMatch(systemPrompt, /\+60 3-7654 3210/);
    assert.deepEqual(policy?.selectedSourceKeys, ["kota-contact-document"]);
    assert.ok(policy?.knowledgeAttributeCoverage?.covered?.some(
      (item) => item.intent === "contact" && item.attribute === "contact",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(policy?.requestedAttributesSupportedBySelectedEvidence, true);
    assert.equal(policy?.selectorAnswerabilityConsistent, true);
    assert.equal(selectionDiagnostic?.candidates?.[0]?.entityMatch, true);
    assert.equal(selectionDiagnostic?.candidates?.[0]?.requestedAttributeSupport?.[0]?.supported, true);
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
    assert.equal(retrievalStage?.selectedCount, 1);
    const serializedLogs = JSON.stringify(logs);
    assert.doesNotMatch(serializedLogs, /the earlier branch/i);
    assert.doesNotMatch(serializedLogs, /Kota Kemuning/i);
    assert.doesNotMatch(serializedLogs, /\+60 3-1234 5678/);
    assert.doesNotMatch(serializedLogs, /contact number: \+60/);
    assert.equal(reply, "The contact number for Kota Kemuning branch is +60 3-1234 5678.");
  },
);

test(
  "Rimbayu map-link evidence aligns selected context, attribute coverage, grounded answer, and diagnostics",
  async () => {
    const mapUrl = "https://maps.app.goo.gl/yiR8qakiggd69vzt7";
    const content = [
      "Address: 20, Jalan Rimbayu 1/5, Bandar Rimbayu, 42500 Rimbayu, Selangor",
      "Phone: 03-3132 8881",
      `Goolge Maps: [Goolge Maps](${mapUrl})`,
      "Operating hours: Monday through Sunday, 8:00 AM to 10:00 PM",
    ].join("\n");
    const fixture = makeReplyFixture(
      "rimbayu-map-link-answer",
      [],
      "Give me Rimbayu location link",
    );
    const evidence: KnowledgeContextItem = {
      id: "rimbayu-map-link-chunk",
      knowledgeSourceId: "synthetic-rimbayu-source",
      providerDocumentId: "synthetic-rimbayu-document",
      title: "Poliklinik Shaik @ Rimbayu",
      sourceType: "rich_text",
      content,
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const answer = JSON.stringify({
      status: "full",
      answer: mapUrl,
      claims: [{ text: mapUrl, chunk_id: "K1", quote: mapUrl }],
    });
    const logs: unknown[][] = [];
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(answer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [evidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverage?: { covered?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const selection = logs.find(
      (entry) => entry[0] === "AI KNOWLEDGE SELECTION DIAGNOSTICS",
    )?.[1] as {
      candidates?: Array<{
        decision?: string;
        requestedAttributeSupport?: Array<{ attribute: string; supported: boolean }>;
      }>;
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(reply, mapUrl);
    assert.match(systemPrompt, /20, Jalan Rimbayu 1\/5/);
    assert.match(systemPrompt, new RegExp(mapUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(policy?.selectedSourceKeys, ["synthetic-rimbayu-document"]);
    assert.ok(policy?.knowledgeAttributeCoverage?.covered?.some(
      (item) => item.intent === "location" && item.attribute === "map_link",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(selection?.candidates?.[0]?.decision, "selected");
    assert.ok(selection?.candidates?.[0]?.requestedAttributeSupport?.some(
      (item) => item.attribute === "map_link" && item.supported,
    ));
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
  },
);

test(
  "supported branch opening hours reach the prompt and produce an answer consistent with selection and grounding",
  async () => {
    const schedule = "Monday through Sunday, 8:00 AM to 10:00 PM";
    const fixture = makeReplyFixture(
      "synthetic-branch-hours-answer",
      [],
      "What are the Northside branch opening hours?",
    );
    const evidence: KnowledgeContextItem = {
      id: "northside-hours-chunk",
      knowledgeSourceId: "synthetic-northside-hours-source",
      providerDocumentId: "synthetic-northside-hours-document",
      title: "Northside Branch Information",
      sourceType: "rich_text",
      content: `Northside Branch operating hours are ${schedule}.`,
      score: 0.94,
      rerankerScore: 0.94,
      retrievalMethod: "hybrid",
    };
    const answer = JSON.stringify({
      status: "full",
      answer: `Northside Branch operating hours are ${schedule}.`,
      claims: [{
        text: `Northside Branch operating hours are ${schedule}.`,
        chunk_id: "K1",
        quote: `Northside Branch operating hours are ${schedule}.`,
      }],
    });
    const logs: unknown[][] = [];
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(answer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [evidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverage?: { covered?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(reply, `Northside Branch operating hours are ${schedule}.`);
    assert.match(systemPrompt, /Northside Branch operating hours/);
    assert.match(systemPrompt, /Monday through Sunday, 8:00 AM to 10:00 PM/);
    assert.deepEqual(policy?.selectedSourceKeys, ["synthetic-northside-hours-document"]);
    assert.ok(policy?.knowledgeAttributeCoverage?.covered?.some(
      (item) => item.intent === "hours" && item.attribute === "time",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
  },
);

test(
  "branch-specific service capability is answered from service evidence rather than treated as location or promotion",
  async () => {
    const fixture = makeReplyFixture(
      "synthetic-branch-service-answer",
      [],
      "Does the Northside branch provide physiotherapy?",
    );
    const evidence: KnowledgeContextItem = {
      id: "northside-physiotherapy-chunk",
      knowledgeSourceId: "synthetic-northside-service-source",
      providerDocumentId: "synthetic-northside-service-document",
      title: "Northside Branch Services",
      sourceType: "rich_text",
      content: "Northside Branch services include physiotherapy.",
      score: 0.94,
      rerankerScore: 0.94,
      retrievalMethod: "hybrid",
    };
    const answer = JSON.stringify({
      status: "full",
      answer: "Northside Branch services include physiotherapy.",
      claims: [{
        text: "Northside Branch services include physiotherapy.",
        chunk_id: "K1",
        quote: "Northside Branch services include physiotherapy.",
      }],
    });
    const logs: unknown[][] = [];
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(answer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [evidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverage?: { covered?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(reply, "Northside Branch services include physiotherapy.");
    assert.match(systemPrompt, /Northside Branch services include physiotherapy/);
    assert.deepEqual(policy?.selectedSourceKeys, ["synthetic-northside-service-document"]);
    assert.ok(policy?.knowledgeAttributeCoverage?.covered?.some(
      (item) => item.intent === "services" && item.attribute === "service",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
  },
);

test(
  "broad service answers list documented items without implying one selected entry is exhaustive",
  async () => {
    const fixture = makeReplyFixture(
      "tenant-wide-service-catalogue",
      [],
      "What services does your clinic provide?",
    );
    const evidence: KnowledgeContextItem = {
      id: "ultrasound-service-chunk",
      knowledgeSourceId: "synthetic-service-source",
      providerDocumentId: "synthetic-ultrasound-document",
      title: "16. Ultrasound",
      sourceType: "rich_text",
      content: "Ultrasound services provide diagnostic imaging.",
      score: 0.56,
      rerankerScore: 0.75,
      retrievalMethod: "hybrid",
    };
    const answer = JSON.stringify({
      status: "full",
      answer: evidence.content,
      claims: [{
        text: evidence.content,
        chunk_id: "K1",
        quote: evidence.content,
      }],
    });
    const logs: unknown[][] = [];
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(answer, "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [evidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverage?: { covered?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(reply, evidence.content);
    assert.match(systemPrompt, /A single service entry is not proof of an exhaustive catalogue/);
    assert.deepEqual(policy?.selectedSourceKeys, ["synthetic-ultrasound-document"]);
    assert.ok(policy?.knowledgeAttributeCoverage?.covered?.some(
      (item) => item.intent === "services" && item.attribute === "service",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
  },
);

test(
  "map-link evidence provides a grounded partial response to a street-address request without inventing an address",
  async () => {
    const fixture = makeReplyFixture(
      "rimbayu-address-with-map-only",
      [],
      "What is the Rimbayu address?",
    );
    const mapOnlyEvidence: KnowledgeContextItem = {
      id: "rimbayu-map-only-chunk",
      knowledgeSourceId: "synthetic-rimbayu-source",
      providerDocumentId: "synthetic-rimbayu-map-only-document",
      title: "Rimbayu Branch Information",
      sourceType: "rich_text",
      content: "Goolge Maps: [Goolge Maps](https://maps.app.goo.gl/yiR8qakiggd69vzt7)",
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const logs: unknown[][] = [];
    const mapUrl = "https://maps.app.goo.gl/yiR8qakiggd69vzt7";
    const partialAnswer = `The street address is not confirmed in the information NUVI has; I can share the map link: ${mapUrl}.`;
    let providerCalls = 0;
    let systemPrompt = "";
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        providerCalls += 1;
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(JSON.stringify({
          status: "partial",
          answer: partialAnswer,
          claims: [{
            text: partialAnswer,
            chunk_id: "K1",
            quote: mapUrl,
          }],
        }), "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [mapOnlyEvidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      knowledgeAttributeCoverageStatus?: string;
      coreAIAnswerability?: { decision?: string; reason?: string };
      selectedCandidateCount?: number;
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(providerCalls, 1);
    assert.equal(policy?.knowledgeAttributeCoverageStatus, "none");
    assert.equal(policy?.coreAIAnswerability?.decision, "answer_partial");
    assert.equal(policy?.coreAIAnswerability?.reason, "partial_knowledge_coverage");
    assert.equal(policy?.selectedCandidateCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "none");
    assert.equal(trace?.answerability?.decision, "answer_partial");
    assert.equal(trace?.grounding?.valid, true);
    assert.match(systemPrompt, new RegExp(mapUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(systemPrompt, /does not confirm the requested attribute/i);
    assert.match(systemPrompt, /explicitly say that NUVI's information does not confirm it/i);
    assert.match(reply, new RegExp(mapUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(reply, partialAnswer);
    assert.doesNotMatch(reply, /\b\d+\s+(?:Jalan|Street|Road)\b/i);
  },
);

test(
  "attribute recovery retrieves eligible address evidence once and grounds the complete answer",
  async () => {
    const fixture = makeReplyFixture("attribute-recovery-address", [], "What is the Rimbayu address?");
    const mapEvidence: KnowledgeContextItem = {
      id: "rimbayu-map-chunk",
      knowledgeSourceId: "rimbayu-source",
      providerDocumentId: "rimbayu-document",
      title: "Rimbayu Branch Information",
      sourceType: "rich_text",
      content: "Rimbayu branch map: https://maps.example.test/rimbayu",
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const addressEvidence: KnowledgeContextItem = {
      ...mapEvidence,
      id: "rimbayu-address-chunk",
      content: "Rimbayu branch information. Address: 20 Road, Rimbayu.",
      score: 0.94,
      rerankerScore: 0.94,
    };
    let recoveryCalls = 0;
    let recoveryQuery = "";
    let recoveryOriginalQuery = "";
    let systemPrompt = "";
    const logs: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        const evidenceMatch = [...systemPrompt.matchAll(
          /Evidence ID: (K\d+)\nSource: [^\n]*\n([\s\S]*?)(?=\n\nEvidence ID:|$)/g,
        )].find((match) => match[2].includes(addressEvidence.content));
        assert.ok(evidenceMatch, "recovered address must be present in model context");
        const answer = "The Rimbayu branch is at 20 Road, Rimbayu.";
        return makeResponse(JSON.stringify({
          status: "full",
          answer,
          claims: [{
            text: answer,
            chunk_id: evidenceMatch[1],
            quote: addressEvidence.content,
          }],
        }), "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [mapEvidence],
        "",
        "Rimbayu address",
        undefined,
        "What is the Rimbayu address?",
        undefined,
        undefined,
        async (query, originalQuery) => {
          recoveryCalls += 1;
          recoveryQuery = query;
          recoveryOriginalQuery = originalQuery;
          return [addressEvidence];
        },
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverageStatus?: string;
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;

    assert.equal(recoveryCalls, 1);
    assert.match(recoveryQuery, /street address/i);
    assert.equal(recoveryOriginalQuery, "Rimbayu address");
    assert.match(systemPrompt, /20 Road, Rimbayu/);
    assert.deepEqual(policy?.selectedSourceKeys, ["rimbayu-document", "rimbayu-document"]);
    assert.equal(policy?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(policy?.coreAIAnswerability?.decision, "answer");
    assert.equal(trace?.retrieval?.selectedCount, 2);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "complete");
    assert.equal(trace?.answerability?.decision, "answer");
    assert.equal(trace?.grounding?.valid, true);
    assert.equal(reply, "The Rimbayu branch is at 20 Road, Rimbayu.");
  },
);

test(
  "attribute recovery is bounded and irrelevant candidates preserve the honest partial answer",
  async () => {
    const fixture = makeReplyFixture("attribute-recovery-miss", [], "What is the Rimbayu address?");
    const mapUrl = "https://maps.example.test/rimbayu";
    const mapEvidence: KnowledgeContextItem = {
      id: "rimbayu-map-only-chunk",
      knowledgeSourceId: "rimbayu-source",
      providerDocumentId: "rimbayu-document",
      title: "Rimbayu Branch Information",
      sourceType: "rich_text",
      content: `Rimbayu branch map: ${mapUrl}`,
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const irrelevantAddress: KnowledgeContextItem = {
      id: "unrelated-address-chunk",
      knowledgeSourceId: "unrelated-source",
      providerDocumentId: "unrelated-document",
      title: "Northern Office Services",
      sourceType: "rich_text",
      content: "The northern office street address is 4 Hill Street.",
      score: 0.1,
      rerankerScore: 0.1,
      retrievalMethod: "hybrid",
    };
    const answer = `The street address is not confirmed in the information NUVI has; I can share the map link: ${mapUrl}.`;
    let recoveryCalls = 0;
    let systemPrompt = "";
    const logs: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat(request) {
        systemPrompt = request.messages[0]?.content ?? "";
        return makeResponse(JSON.stringify({
          status: "partial",
          answer,
          claims: [{ text: answer, chunk_id: "K1", quote: mapUrl }],
        }), "cloudflare");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        fixture.history,
        fixture.message,
        fixture.profile,
        [mapEvidence],
        "",
        "Rimbayu address",
        undefined,
        "What is the Rimbayu address?",
        undefined,
        undefined,
        async () => {
          recoveryCalls += 1;
          return [irrelevantAddress];
        },
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      selectedSourceKeys?: string[];
      knowledgeAttributeCoverageStatus?: string;
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { selectedCount?: number; knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
      grounding?: { valid?: boolean };
    } | undefined;
    const recovery = logs.find((entry) => entry[0] === "AI KNOWLEDGE ATTRIBUTE RECOVERY")?.[1] as {
      attempted?: boolean;
      recoveredCandidateCount?: number;
      missingAttributeCountAfter?: number;
    } | undefined;

    assert.equal(recoveryCalls, 1);
    assert.equal(recovery?.attempted, true);
    assert.equal(recovery?.recoveredCandidateCount, 1);
    assert.ok((recovery?.missingAttributeCountAfter ?? 0) > 0);
    assert.doesNotMatch(systemPrompt, /4 Hill Street/);
    assert.deepEqual(policy?.selectedSourceKeys, ["rimbayu-document"]);
    assert.equal(policy?.knowledgeAttributeCoverageStatus, "none");
    assert.equal(policy?.coreAIAnswerability?.decision, "answer_partial");
    assert.equal(trace?.retrieval?.selectedCount, 1);
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "none");
    assert.equal(trace?.answerability?.decision, "answer_partial");
    assert.equal(trace?.grounding?.valid, true);
    assert.equal(reply, answer);
  },
);

test(
  "resolved branch context without documented contact details safely abstains",
  async () => {
    const fixture = makeReplyFixture("resolved-contact-without-number", [], "the earlier branch");
    const history = [
      makeHistoryMessage("prior-branch", fixture.message.conversationId, "customer", "Can I get Kota Kemuning address?", "2026-10-09T23:57:00.000Z"),
      makeHistoryMessage("contact-request", fixture.message.conversationId, "customer", "What is your contact number?", "2026-10-09T23:58:00.000Z"),
      makeHistoryMessage("contact-clarification", fixture.message.conversationId, "ai", "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.", "2026-10-09T23:59:00.000Z"),
    ];
    const resolved = resolveKnowledgeQuery(
      fixture.message.text,
      history.map((item) => ({ role: item.senderType === "customer" ? "customer" as const : "ai" as const, text: item.text, timestamp: item.timestamp })),
      "2026-10-10T00:00:00.000Z",
    );
    const addressOnly: KnowledgeContextItem = {
      id: "kota-address-only-chunk",
      knowledgeSourceId: "kota-address-only-source",
      providerDocumentId: "kota-address-only-document",
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content: "Kota Kemuning branch address: 12 Jalan Anggerik.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };
    let providerCalls = 0;
    const logs: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    const ai: AIProvider = {
      async chat() {
        providerCalls += 1;
        throw new Error("No model call should be made without contact evidence");
      },
    };
    let reply: string;
    try {
      reply = await generateAIReply(
        ai, history, fixture.message, fixture.profile, [addressOnly], "",
        resolved.retrievalQuery, undefined, resolved.analysisQuery ?? "",
      );
    } finally {
      console.log = originalConsoleLog;
    }
    const policy = logs.find((entry) => entry[0] === "AI RESPONSE POLICY")?.[1] as {
      knowledgeAttributeCoverageStatus?: string;
      knowledgeAttributeCoverage?: { missing?: Array<{ intent: string; attribute: string }> };
      coreAIAnswerability?: { decision?: string };
    } | undefined;
    const trace = logs.find((entry) => entry[0] === "AI TRACE")?.[1] as {
      retrieval?: { knowledgeAttributeCoverageStatus?: string };
      answerability?: { decision?: string };
    } | undefined;
    assert.equal(providerCalls, 0);
    assert.equal(policy?.knowledgeAttributeCoverageStatus, "none");
    assert.ok(policy?.knowledgeAttributeCoverage?.missing?.some(
      (item) => item.intent === "contact" && item.attribute === "contact",
    ));
    assert.equal(policy?.coreAIAnswerability?.decision, "handoff");
    assert.equal(trace?.retrieval?.knowledgeAttributeCoverageStatus, "none");
    assert.equal(trace?.answerability?.decision, "handoff");
    assert.match(reply, /confirm|team/i);
    assert.doesNotMatch(reply, /\+?60|12 Jalan Anggerik/);
  },
);

test(
  "resolved address context remains the rewrite fallback when provider rewriting fails",
  async () => {
    const query = "Can I know the address?";
    const resolution = resolveKnowledgeQuery(
      query,
      [
        {
          role: "customer",
          text: "Can you tell me the address for Kota Kemuning branch?",
          timestamp: "2026-10-11T15:00:00.000Z",
        },
      ],
      "2026-10-11T15:01:00.000Z",
    );
    let providerCalls = 0;
    const ai: AIProvider = {
      async chat() {
        providerCalls += 1;
        throw new Error("Gemini query rewrite unavailable");
      },
    };

    const rewrite = await rewriteKnowledgeQuery(
      ai,
      query,
      resolution.retrievalQuery,
    );

    assert.equal(resolution.contextUsed, true);
    assert.match(rewrite.query, /Kota Kemuning/i);
    assert.equal(rewrite.reason, "provider_error");
    assert.equal(providerCalls, 1);
  },
);

test(
  "address follow-up ignores branch history from another conversation",
  async () => {
    const fixture = makeReplyFixture(
      "cross-conversation-address",
      [],
      "Can I know the address?",
    );
    const otherConversation = makeHistoryMessage(
      "other-conversation-branch",
      "different-conversation",
      "customer",
      "Can you tell me the address for Kota Kemuning branch?",
      "2026-10-09T23:59:00.000Z",
    );
    const branchEvidence: KnowledgeContextItem = {
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content: "Kota Kemuning branch is located at 12 Jalan Anggerik, Shah Alam.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };
    let providerCalls = 0;
    let trace: { retrieval?: { selectedCount?: number } } | undefined;
    const originalConsoleLog = console.log;
    console.log = ((...args: unknown[]) => {
      if (args[0] === "AI TRACE") {
        trace = args[1] as { retrieval?: { selectedCount?: number } };
      }
    }) as typeof console.log;

    const ai: AIProvider = {
      async chat() {
        providerCalls += 1;
        throw new Error("No answer should be generated without current-conversation evidence");
      },
    };

    let reply: string;
    try {
      reply = await generateAIReply(
        ai,
        [otherConversation],
        fixture.message,
        fixture.profile,
        [branchEvidence],
      );
    } finally {
      console.log = originalConsoleLog;
    }

    assert.equal(providerCalls, 0);
    assert.equal(trace?.retrieval?.selectedCount, 0);
    assert.match(reply, /confirm|team/i);
  },
);

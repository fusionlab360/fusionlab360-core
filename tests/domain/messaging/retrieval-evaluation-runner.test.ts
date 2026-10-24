import assert from "node:assert/strict";
import { test } from "node:test";

import {
  selectKnowledgeForAnswer,
  type KnowledgeContextItem,
} from "../../../src/domain/messaging/knowledge-intelligence";
import {
  runRetrievalEvaluation,
} from "../../../src/domain/messaging/retrieval-evaluation-runner";
import type {
  RetrievalEvaluationBenchmarkCase,
} from "../../../src/domain/messaging/retrieval-evaluation-cases";

const verifiedServiceCase: RetrievalEvaluationBenchmarkCase = {
  id: "runner-service-001",
  question: "What services do you provide?",
  expectedAnswerable: true,
  relevantSourceKeys: ["services:general"],
  requiredSourceKeys: ["services:general"],
  expectedIntents: ["services"],
  language: "en",
  category: "services",
  labelNote: "Verified test fixture only.",
  reviewStatus: "verified",
};

const serviceDocument: KnowledgeContextItem = {
  id: "chunk-service-001",
  knowledgeSourceId: "source-service-001",
  providerDocumentId: "document-service-001",
  chunkIndex: 0,
  title: "Services",
  sourceType: "rich_text",
  content: [
    "Poliklinik Shaik Services",
    "Medical Care",
    "Physiotherapy",
    "Occupational Health Service",
    "Wound Care",
    "Dietetics",
  ].join("\n"),
  score: 0.95,
  retrievalMethod: "hybrid",
};

test(
  "evaluation runner maps retrieved evidence and calculates retrieval metrics",
  async () => {
    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [serviceDocument],
      },
      sourceKeyById: {
        "document-service-001": "services:general",
      },
      cases: [verifiedServiceCase],
      topK: 5,
    });

    assert.equal(result.cases.length, 1);

    const observed = result.cases[0];

    assert.ok(observed);
    assert.equal(observed.highRisk, false);
    assert.deepEqual(
      observed.retrievedSourceKeys,
      ["services:general"],
    );
    assert.deepEqual(
      observed.selectedSourceKeys,
      ["services:general"],
    );
    assert.deepEqual(
      observed.missingRequiredSourceKeys,
      [],
    );
    assert.equal(observed.unmappedRetrievedItems, 0);

    assert.equal(observed.candidateDiagnostics.length, 1);

    const diagnostic = observed.candidateDiagnostics[0];

    assert.ok(diagnostic);
    assert.equal(diagnostic.decision, "selected");
    assert.equal(diagnostic.rejectionReason, null);
    assert.equal(diagnostic.providerDocumentId, "document-service-001");
    assert.equal(diagnostic.chunkId, "chunk-service-001");
    assert.equal(diagnostic.score, 0.95);

    assert.ok(result.summary);
    assert.equal(result.summary.verifiedCasesEvaluated, 1);
    assert.equal(result.summary.recallAtK, 1);
    assert.equal(result.summary.meanReciprocalRank, 1);
    assert.equal(result.summary.answerableRetrievalHitRate, 1);
    assert.equal(result.summary.selectedEvidenceHitRate, 1);
    assert.equal(
      result.summary.requiredEvidenceCompleteRate,
      1,
    );
  },
);

test(
  "evaluation runner resolves a contextual address follow-up before retrieval and selection",
  async () => {
    const branchCase: RetrievalEvaluationBenchmarkCase = {
      ...verifiedServiceCase,
      id: "runner-contextual-address-001",
      question: "Can I know the address?",
      history: [
        {
          role: "customer",
          text: "Can you tell me the address for Northside branch?",
          timestamp: "2026-10-14T10:00:00.000Z",
        },
      ],
      currentQueryAt: "2026-10-14T10:01:00.000Z",
      relevantSourceKeys: ["branch:northside"],
      requiredSourceKeys: ["branch:northside"],
      expectedIntents: ["contact"],
      category: "branch_specific",
    };
    const branchDocument: KnowledgeContextItem = {
      id: "chunk-northside-address",
      knowledgeSourceId: "source-northside-address",
      providerDocumentId: "document-northside-address",
      title: "Northside Branch Information",
      sourceType: "rich_text",
      content: "Northside branch address: 18 Sample Road, Sampletown.",
      score: 0.91,
      retrievalMethod: "hybrid",
    };
    let receivedQuery = "";
    let receivedOriginalQuery = "";

    const result = await runRetrievalEvaluation({
      retriever: {
        search: async (query, originalQuery) => {
          receivedQuery = query;
          receivedOriginalQuery = originalQuery ?? "";
          return [branchDocument];
        },
      },
      sourceKeyById: {
        "document-northside-address": "branch:northside",
      },
      cases: [branchCase],
    });

    const observed = result.cases[0];
    assert.ok(observed);
    assert.match(receivedQuery, /Northside/i);
    assert.match(receivedQuery, /address/i);
    assert.equal(receivedOriginalQuery, branchCase.question);
    assert.equal(observed.contextUsed, true);
    assert.equal(observed.contextSourceKind, "resolved_branch_address");
    assert.deepEqual(observed.retrievedSourceKeys, ["branch:northside"]);
    assert.deepEqual(observed.selectedSourceKeys, ["branch:northside"]);
    assert.equal(observed.candidateDiagnostics[0]?.decision, "selected");
  },
);

test(
  "contextual evaluation requires a timestamp for deterministic history resolution",
  async () => {
    const contextualCase: RetrievalEvaluationBenchmarkCase = {
      ...verifiedServiceCase,
      history: [
        {
          role: "customer",
          text: "Tell me about Northside branch.",
          timestamp: "2026-10-14T10:00:00.000Z",
        },
      ],
    };

    await assert.rejects(
      runRetrievalEvaluation({
        retriever: { search: async () => [] },
        sourceKeyById: {},
        cases: [contextualCase],
      }),
      /requires currentQueryAt/,
    );
  },
);

test(
  "evaluation runner reports existing high-risk classification without changing selection",
  async () => {
    const highRiskCase: RetrievalEvaluationBenchmarkCase = {
      ...verifiedServiceCase,
      id: "runner-high-risk-001",
      question: "What is the price of wound care?",
    };
    const expectedSelection = selectKnowledgeForAnswer(
      highRiskCase.question,
      [serviceDocument],
      highRiskCase.question,
    );

    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [serviceDocument],
      },
      sourceKeyById: {
        "document-service-001": "services:general",
      },
      cases: [highRiskCase],
    });

    const observed = result.cases[0];

    assert.ok(observed);
    assert.equal(observed.highRisk, true);
    assert.deepEqual(
      observed.candidateDiagnostics,
      expectedSelection.candidateDiagnostics,
    );
    assert.deepEqual(
      observed.selectedSourceKeys,
      expectedSelection.selected.map(() => "services:general"),
    );
  },
);

test(
  "draft cases produce diagnostics but no quality scores",
  async () => {
    const draftCase: RetrievalEvaluationBenchmarkCase = {
      ...verifiedServiceCase,
      id: "runner-draft-001",
      reviewStatus: "draft",
    };

    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [serviceDocument],
      },
      sourceKeyById: {
        "document-service-001": "services:general",
      },
      cases: [draftCase],
    });

    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0]?.reviewStatus, "draft");
    assert.equal(result.summary, null);
  },
);

test(
  "unmapped source identifiers are reported rather than guessed",
  async () => {
    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [serviceDocument],
      },
      sourceKeyById: {},
      cases: [verifiedServiceCase],
    });

    const observed = result.cases[0];

    assert.ok(observed);
    assert.deepEqual(observed.retrievedSourceKeys, []);
    assert.equal(observed.unmappedRetrievedItems, 1);

    assert.equal(observed.unmappedRetrievedSources.length, 1);

    const unmapped = observed.unmappedRetrievedSources[0];

    assert.ok(unmapped);
    assert.equal(
    unmapped.title,
    serviceDocument.title?.trim() || "(untitled)",
    );
    assert.equal(
    unmapped.sourceType,
    serviceDocument.sourceType || "unknown",
    );

    // Without a mapping, do not silently match an expected source.
    assert.deepEqual(observed.matchedRelevantSourceKeys, []);
  },
);

test(
  "empty retrieval results do not fabricate evidence hits",
  async () => {
    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [],
      },
      sourceKeyById: {
        "document-service-001": "services:general",
      },
      cases: [verifiedServiceCase],
    });

    assert.deepEqual(
      result.cases[0]?.retrievedSourceKeys,
      [],
    );
    assert.deepEqual(
      result.cases[0]?.missingRequiredSourceKeys,
      ["services:general"],
    );

    assert.ok(result.summary);
    assert.equal(result.summary.recallAtK, 0);
    assert.equal(result.summary.answerableRetrievalHitRate, 0);
    assert.equal(result.summary.selectedEvidenceHitRate, 0);
    assert.equal(
      result.summary.requiredEvidenceCompleteRate,
      0,
    );
  },
);


test(
  "evaluation runner preserves rejection reasons for ineligible evidence",
  async () => {
    const unrelatedDocument: KnowledgeContextItem = {
      ...serviceDocument,
      id: "chunk-unrelated-001",
      knowledgeSourceId: "source-unrelated-001",
      providerDocumentId: "document-unrelated-001",
      title: "Parking Information",
      content: "Parking is available behind the building.",
      score: 0.12,
      retrievalMethod: "vector",
      rerankerScore: -2,
      rerankerRank: 1,
    };

    const result = await runRetrievalEvaluation({
      retriever: {
        search: async () => [unrelatedDocument],
      },
      sourceKeyById: {},
      cases: [verifiedServiceCase],
      topK: 5,
    });

    const observed = result.cases[0];

    assert.ok(observed);
    assert.equal(observed.candidateDiagnostics.length, 1);

    const diagnostic = observed.candidateDiagnostics[0];

    assert.ok(diagnostic);
    assert.equal(diagnostic.decision, "rejected");
    assert.ok(diagnostic.rejectionReason);
    assert.equal(diagnostic.providerDocumentId, "document-unrelated-001");
    assert.equal(diagnostic.chunkId, "chunk-unrelated-001");
    assert.equal(diagnostic.score, 0.12);
    assert.equal(diagnostic.rerankerScore, -2);
  },
);

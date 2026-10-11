
import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeRetrievalEvaluation,
  type RetrievalEvaluationCase,
  type RetrievalEvaluationObservation,
} from "./retrieval-evaluation";

test("retrieval evaluation calculates quality metrics correctly", () => {
  const cases: RetrievalEvaluationCase[] = [
    {
      id: "services",
      relevantSourceKeys: [
        "branch-details",
        "clinic-services",
      ],
      expectedAnswerable: true,
    },
    {
      id: "opening-hours",
      relevantSourceKeys: ["opening-hours"],
      expectedAnswerable: true,
    },
    {
      id: "unknown-policy",
      relevantSourceKeys: [],
      expectedAnswerable: false,
    },
  ];

  const observations: RetrievalEvaluationObservation[] = [
    {
      caseId: "services",
      retrievedSourceKeys: [
        "branch-details",
        "irrelevant-source",
        "clinic-services",
      ],
      selectedSourceKeys: ["branch-details"],
      answerProduced: true,
      handedOff: false,
      groundingRejected: false,
      unsupportedClaimDetected: false,
      providerFallbackUsed: false,
      latencyMs: 100,
    },
    {
      caseId: "opening-hours",
      retrievedSourceKeys: [
        "irrelevant-source",
        "opening-hours",
      ],
      selectedSourceKeys: [],
      answerProduced: false,
      handedOff: true,
      groundingRejected: false,
      unsupportedClaimDetected: true,
      providerFallbackUsed: true,
      latencyMs: 200,
    },
    {
      caseId: "unknown-policy",
      retrievedSourceKeys: [],
      selectedSourceKeys: [],
      answerProduced: false,
      handedOff: true,
      groundingRejected: false,
      unsupportedClaimDetected: false,
      providerFallbackUsed: false,
      latencyMs: 300,
    },
  ];

  const result = summarizeRetrievalEvaluation(
    cases,
    observations,
    2,
  );

  assert.equal(result.casesEvaluated, 3);
  assert.equal(result.recallAtK, 0.75);
  assert.equal(result.meanReciprocalRank, 0.75);
  assert.equal(result.answerableRetrievalHitRate, 1);
  assert.equal(result.groundedAnswerSuccessRate, 0.5);
  assert.equal(result.falseHandoffRate, 0.5);
  assert.ok(
    Math.abs(result.unsupportedClaimRate! - 1 / 3) < 1e-10,
  );
  assert.equal(result.averageLatencyMs, 200);
  assert.ok(
    Math.abs(result.providerFallbackRate! - 1 / 3) < 1e-10,
  );
});

test("retrieval evaluation handles an empty dataset safely", () => {
  const result = summarizeRetrievalEvaluation([], []);

  assert.equal(result.casesEvaluated, 0);
  assert.equal(result.recallAtK, null);
  assert.equal(result.meanReciprocalRank, null);
  assert.equal(result.answerableRetrievalHitRate, null);
  assert.equal(result.groundedAnswerSuccessRate, null);
  assert.equal(result.falseHandoffRate, null);
  assert.equal(result.unsupportedClaimRate, null);
  assert.equal(result.averageLatencyMs, null);
  assert.equal(result.providerFallbackRate, null);
  assert.equal(result.selectedEvidenceHitRate, null);
  assert.equal(result.unanswerableAnswerRate, null);
});


test(
  "measures selected evidence hits and answers to unanswerable questions",
  () => {
    const cases: RetrievalEvaluationCase[] = [
      {
        id: "service-hit",
        relevantSourceKeys: ["services"],
        expectedAnswerable: true,
      },
      {
        id: "hours-miss",
        relevantSourceKeys: ["opening-hours"],
        expectedAnswerable: true,
      },
      {
        id: "unknown-safe",
        relevantSourceKeys: [],
        expectedAnswerable: false,
      },
      {
        id: "unknown-answered",
        relevantSourceKeys: [],
        expectedAnswerable: false,
      },
    ];

    const observations: RetrievalEvaluationObservation[] = [
      {
        caseId: "service-hit",
        retrievedSourceKeys: ["services"],
        selectedSourceKeys: ["services"],
        answerProduced: true,
        handedOff: false,
        groundingRejected: false,
        unsupportedClaimDetected: false,
        providerFallbackUsed: false,
        latencyMs: 100,
      },
      {
        caseId: "hours-miss",
        retrievedSourceKeys: ["opening-hours"],
        selectedSourceKeys: [],
        answerProduced: false,
        handedOff: true,
        groundingRejected: false,
        unsupportedClaimDetected: false,
        providerFallbackUsed: false,
        latencyMs: 100,
      },
      {
        caseId: "unknown-safe",
        retrievedSourceKeys: [],
        selectedSourceKeys: [],
        answerProduced: false,
        handedOff: true,
        groundingRejected: false,
        unsupportedClaimDetected: false,
        providerFallbackUsed: false,
        latencyMs: 100,
      },
      {
        caseId: "unknown-answered",
        retrievedSourceKeys: [],
        selectedSourceKeys: [],
        answerProduced: true,
        handedOff: false,
        groundingRejected: false,
        unsupportedClaimDetected: true,
        providerFallbackUsed: false,
        latencyMs: 100,
      },
    ];

    const result = summarizeRetrievalEvaluation(
      cases,
      observations,
    );

    assert.equal(result.selectedEvidenceHitRate, 0.5);
    assert.equal(result.unanswerableAnswerRate, 0.5);
  },
);


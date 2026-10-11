import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeKnowledgeQuery,
  selectKnowledgeForAnswer,
  type KnowledgeContextItem,
} from "./knowledge-intelligence";

const serviceDocument: KnowledgeContextItem = {
  title: "Services",
  sourceType: "rich_text",
  content: [
    "Poliklinik Shaik Services",
    "The following healthcare services are provided by Poliklinik Shaik:",
    "Medical Care",
    "Physiotherapy",
    "Occupational Health Service",
    "Wound Care",
    "Dietetics",
  ].join("\n"),
  score: 0.95,
  retrievalMethod: "hybrid",
};

function hasServiceAttribute(
  requirements: { intent: string; attribute: string }[],
): boolean {
  return requirements.some(
    (item) =>
      item.intent === "services" &&
      item.attribute === "service",
  );
}


test(
  "generic service question with greeting accepts approved service evidence",
  () => {
    const result = selectKnowledgeForAnswer(
      "Hi, what services do you provide?",
      [serviceDocument],
    );

    assert.ok(
      hasServiceAttribute(result.attributeCoverage.covered),
      `Expected service attribute coverage. Actual: ${JSON.stringify(
        result.attributeCoverage,
      )}`,
    );

    assert.equal(
      result.attributeCoverage.missing.some(
        (item) =>
          item.intent === "services" &&
          item.attribute === "service",
      ),
      false,
      `Service attribute should not remain missing: ${JSON.stringify(
        result.attributeCoverage,
      )}`,
    );
  },
);

test(
  "generic service evidence does not prove services for a named branch",
  () => {
    const result = selectKnowledgeForAnswer(
      "Which services does the Alam Impian branch offer?",
      [serviceDocument],
    );

    assert.equal(
      hasServiceAttribute(result.attributeCoverage.covered),
      false,
      "Generic service evidence must not prove branch-specific availability.",
    );
  },
);


test(
  "neural reranker scores are preserved in ranked knowledge",
  () => {
    const strongerNeuralEvidence: KnowledgeContextItem = {
      ...serviceDocument,
      title: "Services - neural winner",
      content: [
        "Poliklinik Shaik provides medical care, physiotherapy,",
        "occupational health service, wound care, and dietetics.",
      ].join(" "),
      score: 0.8,
      rerankerScore: 1.2,
    };

    const weakerNeuralEvidence: KnowledgeContextItem = {
      ...serviceDocument,
      title: "Services - neural lower score",
      content: [
        "Poliklinik Shaik provides medical care, physiotherapy,",
        "occupational health service, wound care, and dietetics.",
      ].join(" "),
      score: 0.95,
      rerankerScore: -0.5,
    };

    const result = selectKnowledgeForAnswer(
      "What services do you provide?",
      [weakerNeuralEvidence, strongerNeuralEvidence],
    );

    const strongerRank = result.ranked.findIndex(
      (item) => item.title === "Services - neural winner",
    );

    const weakerRank = result.ranked.findIndex(
      (item) => item.title === "Services - neural lower score",
    );

    assert.notEqual(strongerRank, -1);
    assert.notEqual(weakerRank, -1);
    assert.ok(
      strongerRank < weakerRank,
      "Higher neural score should rank ahead of lower neural score",
    );
  },
);

test(
  "legacy heuristic ranking remains available without neural scores",
  () => {
    const strongerVectorEvidence: KnowledgeContextItem = {
      ...serviceDocument,
      title: "Services - stronger vector score",
      score: 0.99,
    };

    const weakerVectorEvidence: KnowledgeContextItem = {
      ...serviceDocument,
      title: "Services - weaker vector score",
      score: 0.7,
    };

    const result = selectKnowledgeForAnswer(
      "What services do you provide?",
      [weakerVectorEvidence, strongerVectorEvidence],
    );

    assert.equal(
      result.ranked[0]?.title,
      "Services - stronger vector score",
    );
  },
);

test(
  "source identity survives knowledge ranking and selection",
  () => {
    const identifiedDocument: KnowledgeContextItem = {
      ...serviceDocument,
      id: "chunk-test-001",
      knowledgeSourceId: "source-test-001",
      providerDocumentId: "document-test-001",
      chunkIndex: 3,
    };

    const result = selectKnowledgeForAnswer(
      "What services do you provide?",
      [identifiedDocument],
    );

    const rankedItem = result.ranked.find(
      (item) => item.title === identifiedDocument.title,
    );

    assert.ok(rankedItem, "Expected the source to remain in ranked results");
    assert.equal(rankedItem.id, "chunk-test-001");
    assert.equal(rankedItem.knowledgeSourceId, "source-test-001");
    assert.equal(rankedItem.providerDocumentId, "document-test-001");
    assert.equal(rankedItem.chunkIndex, 3);

    const selectedItem = result.selected.find(
      (item) => item.title === identifiedDocument.title,
    );

    assert.ok(selectedItem, "Expected the approved service evidence to be selected");
    assert.equal(selectedItem.id, "chunk-test-001");
    assert.equal(selectedItem.knowledgeSourceId, "source-test-001");
    assert.equal(selectedItem.providerDocumentId, "document-test-001");
    assert.equal(selectedItem.chunkIndex, 3);
  },
);

test(
  "branch-specific service questions are not misclassified as promotions",
  () => {
    const analysis = analyzeKnowledgeQuery(
      "Which services does the Alam Impian branch offer?",
    );

    assert.equal(
      analysis.intent,
      "services",
      `Expected services intent. Actual: ${JSON.stringify(analysis)}`,
    );

    assert.ok(
      analysis.intents.includes("services"),
      "Expected services in detected intents",
    );
  },
);

test(
  "explicit promotion questions retain promotion intent",
  () => {
    const analysis = analyzeKnowledgeQuery(
      "What promotions are available for wound care?",
    );

    assert.equal(
      analysis.intent,
      "promotion",
      `Expected promotion intent. Actual: ${JSON.stringify(analysis)}`,
    );
  },
);

test(
  "ordinary service offer questions resolve to services",
  () => {
    const analysis = analyzeKnowledgeQuery(
      "What services do you offer?",
    );

    assert.equal(analysis.intent, "services");
  },
);


import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeKnowledgeQuery,
  selectKnowledgeForAnswer,
  type KnowledgeContextItem,
} from "./knowledge-intelligence";
import { resolveKnowledgeQuery } from "./knowledge-query-context";

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

const rimbayuBranchDocument: KnowledgeContextItem = {
  id: "rimbayu-branch-chunk",
  knowledgeSourceId: "synthetic-rimbayu-source",
  providerDocumentId: "synthetic-rimbayu-document",
  title: "Poliklinik Shaik @ Rimbayu",
  sourceType: "rich_text",
  content: [
    "Address: 20, Jalan Rimbayu 1/5, Bandar Rimbayu, 42500 Rimbayu, Selangor",
    "Phone: 03-3132 8881",
    "Goolge Maps: [Goolge Maps](https://maps.app.goo.gl/yiR8qakiggd69vzt7)",
    "Operating hours: Monday through Sunday, 8:00 AM to 10:00 PM",
  ].join("\n"),
  score: 0.95,
  rerankerScore: 0.95,
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
  "tenant-wide service questions select relevant evidence without treating clinic as a branch entity",
  () => {
    const ultrasoundEvidence: KnowledgeContextItem = {
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

    const result = selectKnowledgeForAnswer(
      "What service your clinic provide?",
      [ultrasoundEvidence],
    );
    const candidate = result.candidateDiagnostics[0];

    assert.equal(result.analysis.intent, "services");
    assert.deepEqual(result.selected.map((item) => item.providerDocumentId), [
      "synthetic-ultrasound-document",
    ]);
    assert.equal(candidate?.entityTermCount, 0);
    assert.equal(candidate?.entityMatch, false);
    assert.equal(candidate?.focusPhraseMatch, false);
    assert.equal(candidate?.exactPhraseMatch, false);
    assert.equal(candidate?.decision, "selected");
    assert.ok(result.attributeCoverage.covered.some(
      (item) => item.intent === "services" && item.attribute === "service",
    ));
  },
);

test(
  "tenant-wide service eligibility does not admit unrelated or weak service-term matches",
  () => {
    const weakServiceDeskMatch: KnowledgeContextItem = {
      title: "Customer Service Desk",
      sourceType: "rich_text",
      content: "The service desk is next to the parking area.",
      score: 0.56,
      rerankerScore: 0.75,
      retrievalMethod: "hybrid",
    };
    const unrelatedEvidence: KnowledgeContextItem = {
      title: "Parking",
      sourceType: "rich_text",
      content: "Parking is available behind the building.",
      score: 0.2,
      rerankerScore: 0.2,
      retrievalMethod: "hybrid",
    };

    for (const evidence of [weakServiceDeskMatch, unrelatedEvidence]) {
      const result = selectKnowledgeForAnswer(
        "What service your clinic provide?",
        [evidence],
      );
      assert.equal(result.selected.length, 0, evidence.title);
      assert.equal(result.attributeCoverage.covered.length, 0, evidence.title);
      assert.equal(result.candidateDiagnostics[0]?.decision, "rejected", evidence.title);
    }
  },
);

test(
  "a branch-specific service question excludes evidence explicitly about another branch",
  () => {
    const otherBranchServices: KnowledgeContextItem = {
      id: "southside-services-chunk",
      knowledgeSourceId: "synthetic-southside-source",
      providerDocumentId: "synthetic-southside-document",
      title: "Southside Branch Services",
      sourceType: "rich_text",
      content: "Southside Branch services include physiotherapy.",
      score: 0.94,
      rerankerScore: 0.94,
      retrievalMethod: "hybrid",
    };

    const result = selectKnowledgeForAnswer(
      "Which services does the Alam Impian branch offer?",
      [otherBranchServices],
    );

    assert.equal(result.selected.length, 0);
    assert.equal(result.candidateDiagnostics[0]?.entityMatch, false);
    assert.equal(result.candidateDiagnostics[0]?.decision, "rejected");
    assert.equal(result.candidateDiagnostics[0]?.rejectionReason, "different_branch_entity");
    assert.equal(result.attributeCoverage.covered.length, 0);
  },
);

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
    assert.equal(result.selected.length, 1);
    assert.match(result.selected[0]?.content ?? "", /Physiotherapy/);
    assert.equal(
      result.candidateDiagnostics[0]?.decision,
      "selected",
    );
  },
);

test(
  "Rimbayu rich-text fields cover location, address, phone, and daily hours",
  () => {
    const cases = [
      { query: "Give me Rimbayu location link", intent: "location", attribute: "map_link" },
      { query: "What is the Rimbayu address?", intent: "location", attribute: "location" },
      { query: "What is the Rimbayu phone number?", intent: "contact", attribute: "contact" },
      { query: "What are the Rimbayu opening hours?", intent: "hours", attribute: "time" },
    ];

    for (const item of cases) {
      const result = selectKnowledgeForAnswer(item.query, [rimbayuBranchDocument]);
      assert.equal(result.selected.length, 1, item.query);
      assert.ok(
        result.attributeCoverage.covered.some(
          (coverage) => coverage.intent === item.intent && coverage.attribute === item.attribute,
        ),
        `${item.query}: ${JSON.stringify(result.attributeCoverage)}`,
      );
    }
  },
);

test(
  "a selected Google Maps URL supports a map-link request without asserting an address",
  () => {
    const mapLinkOnly: KnowledgeContextItem = {
      ...rimbayuBranchDocument,
      title: "Rimbayu Branch Information",
      content: "Goolge Maps: [Goolge Maps](https://maps.app.goo.gl/yiR8qakiggd69vzt7)",
    };
    const unrelatedBranch: KnowledgeContextItem = {
      ...mapLinkOnly,
      id: "other-branch-link-chunk",
      providerDocumentId: "other-branch-link-document",
      title: "Poliklinik Shaik @ Other Branch",
      content: "Google Maps: [Map](https://maps.app.goo.gl/other-branch)",
      score: 0.1,
      rerankerScore: 0.1,
    };
    const linkRequest = selectKnowledgeForAnswer(
      "Give me Rimbayu location link",
      [mapLinkOnly, unrelatedBranch],
    );
    const addressRequest = selectKnowledgeForAnswer(
      "What is the Rimbayu address?",
      [mapLinkOnly],
    );

    assert.equal(linkRequest.selected.length, 1);
    assert.deepEqual(
      linkRequest.selected.map((item) => item.providerDocumentId),
      ["synthetic-rimbayu-document"],
    );
    assert.ok(linkRequest.intentCoverage.covered.includes("location"));
    assert.ok(linkRequest.attributeCoverage.covered.some((item) => item.attribute === "map_link"));
    assert.equal(addressRequest.selected.length, 1);
    assert.equal(addressRequest.attributeCoverage.covered.some((item) => item.attribute === "location"), false);
    assert.equal(addressRequest.attributeCoverage.missing.some((item) => item.attribute === "location"), true);
  },
);

test(
  "a typo in a Markdown map label does not substitute for a real map URL",
  () => {
    const invalidMapEvidence: KnowledgeContextItem = {
      ...rimbayuBranchDocument,
      content: "Goolge Maps: [Goolge Maps](not-a-url)",
    };
    const result = selectKnowledgeForAnswer(
      "Give me Rimbayu location link",
      [invalidMapEvidence],
    );

    assert.equal(result.attributeCoverage.covered.some((item) => item.attribute === "map_link"), false);
    assert.equal(result.attributeCoverage.missing.some((item) => item.attribute === "map_link"), true);
  },
);

test(
  "unrelated low-confidence evidence cannot answer a generic services question",
  () => {
    const unrelatedEvidence: KnowledgeContextItem = {
      title: "Parking",
      sourceType: "rich_text",
      content: "Parking is available behind the building.",
      score: 0.2,
      rerankerScore: 0.1,
      retrievalMethod: "hybrid",
    };

    const result = selectKnowledgeForAnswer(
      "What services do you provide?",
      [unrelatedEvidence],
    );

    assert.equal(result.selected.length, 0);
    assert.equal(hasServiceAttribute(result.attributeCoverage.covered), false);
    assert.equal(
      result.candidateDiagnostics[0]?.decision,
      "rejected",
    );
  },
);

test(
  "short address follow-up selects branch evidence after its entity is resolved from history",
  () => {
    const branchEvidence: KnowledgeContextItem = {
      id: "kota-address-chunk",
      knowledgeSourceId: "kota-address-source",
      providerDocumentId: "kota-address-document",
      title: "Kota Kemuning Branch Information",
      sourceType: "rich_text",
      content:
        "Kota Kemuning branch is located at 12 Jalan Anggerik, Shah Alam.",
      score: 0.6163,
      rerankerScore: 0.9266,
      retrievalMethod: "hybrid",
    };

    const withoutContext = selectKnowledgeForAnswer(
      "Can I know the address?",
      [branchEvidence],
      "Can I know the address?",
    );
    assert.equal(withoutContext.selected.length, 0);
    assert.equal(
      withoutContext.candidateDiagnostics[0]?.rejectionReason,
      "normal_eligibility_rules_not_satisfied",
    );

    const withContext = selectKnowledgeForAnswer(
      "kota kemuning Can I know the address?",
      [branchEvidence],
      "Can I know the address?",
    );
    assert.equal(withContext.candidateDiagnostics[0]?.entityMatch, true);
    assert.equal(withContext.candidateDiagnostics[0]?.intentMatch, true);
    assert.deepEqual(
      withContext.selected.map((item) => item.providerDocumentId),
      ["kota-address-document"],
    );
  },
);

test(
  "resolved branch clarification supplies entity context to contact selection without changing contact intent",
  () => {
    const history = [
      {
        role: "customer" as const,
        text: "Can I get Kota Kemuning address?",
        timestamp: "2026-10-11T15:00:00.000Z",
      },
      {
        role: "customer" as const,
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai" as const,
        text: "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.",
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ];
    const resolved = resolveKnowledgeQuery(
      "the earlier branch",
      history,
      "2026-10-11T15:01:00.000Z",
    );
    assert.equal(resolved.contextSource, "resolved_branch_clarification");
    assert.equal(resolved.clarificationResolved, true);
    assert.match(resolved.retrievalQuery, /Kota Kemuning/i);
    assert.match(resolved.analysisQuery ?? "", /contact number/i);

    const requestedBranch: KnowledgeContextItem = {
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
    const otherBranch: KnowledgeContextItem = {
      ...requestedBranch,
      id: "shah-alam-contact-chunk",
      knowledgeSourceId: "shah-alam-contact-source",
      providerDocumentId: "shah-alam-contact-document",
      title: "Shah Alam Branch Information",
      content: "Shah Alam branch contact number: +60 3-7654 3210.",
      score: 0.25,
      rerankerScore: 0.2,
    };

    const selection = selectKnowledgeForAnswer(
      resolved.retrievalQuery,
      [requestedBranch, otherBranch],
      resolved.analysisQuery,
    );

    const branchDiagnostic = selection.candidateDiagnostics.find(
      (item) => item.providerDocumentId === "kota-contact-document",
    );
    assert.equal(selection.analysis.intent, "contact");
    assert.ok(selection.analysis.intents.includes("contact"));
    assert.equal(branchDiagnostic?.entityMatch, true);
    assert.equal(branchDiagnostic?.decision, "selected");
    assert.deepEqual(
      selection.selected.map((item) => item.providerDocumentId),
      ["kota-contact-document"],
    );
    assert.ok(
      selection.attributeCoverage.covered.some(
        (item) => item.intent === "contact" && item.attribute === "contact",
      ),
    );
  },
);

test(
  "selection diagnostics explain entity and requested-attribute rejection without logging query or document text",
  () => {
    const customerQuery = "Please share the Blue Mesa branch contact number";
    const unsupportedEntityCandidate: KnowledgeContextItem = {
      id: "chunk-opaque-1",
      knowledgeSourceId: "source-opaque-1",
      providerDocumentId: "document-opaque-1",
      title: "General Contact Information",
      sourceType: "rich_text",
      content: "General contact number: 999 555 0123.",
      score: 0.4,
      rerankerScore: 0.4,
      retrievalMethod: "hybrid",
    };
    const diagnosticLogs: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => diagnosticLogs.push(args);

    let selection: ReturnType<typeof selectKnowledgeForAnswer>;
    try {
      selection = selectKnowledgeForAnswer(
        customerQuery,
        [unsupportedEntityCandidate],
        customerQuery,
      );
    } finally {
      console.log = originalConsoleLog;
    }

    const candidate = selection.candidateDiagnostics[0];
    assert.equal(candidate?.decision, "rejected");
    assert.equal(candidate?.rejectionReason, "normal_eligibility_rules_not_satisfied");
    assert.equal(candidate?.intentMatch, true);
    assert.equal(candidate?.entityMatch, false);
    assert.ok((candidate?.entityTermCount ?? 0) > 0);
    assert.equal(candidate?.entityTokenOverlapCount, 0);
    assert.equal(candidate?.requestedAttributeSupport[0]?.attributeEvidence, true);
    assert.equal(candidate?.requestedAttributeSupport[0]?.entityEvidence, false);
    assert.equal(candidate?.requestedAttributeSupport[0]?.supported, false);
    assert.ok(candidate?.eligibilityPaths.every((path) => !path.passed));
    assert.ok(candidate?.eligibilityPaths.some(
      (path) => path.path === "entity_specific" &&
        path.failedGates.includes("entityMatch"),
    ));
    assert.ok(candidate?.eligibilityPaths.some(
      (path) => path.path === "supported_rescue" &&
        path.failedGates.includes("vectorScore"),
    ));

    const serializedLogs = JSON.stringify(diagnosticLogs);
    assert.doesNotMatch(serializedLogs, /Blue Mesa/i);
    assert.doesNotMatch(serializedLogs, /999 555 0123/);
    assert.doesNotMatch(serializedLogs, /Please share the Blue Mesa branch contact number/);
    assert.doesNotMatch(serializedLogs, /General contact number:/);
  },
);

test("selection diagnostics tolerate candidates without optional identity metadata", () => {
  const logs: unknown[][] = [];
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args);
  let selection: ReturnType<typeof selectKnowledgeForAnswer>;
  try {
    selection = selectKnowledgeForAnswer(
      "Is parking available?",
      [{
        title: "Parking",
        sourceType: "rich_text",
        content: "Parking is available behind the building.",
        score: 0.99,
      }],
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(selection.candidateDiagnostics[0]?.sourceKey, null);
  assert.equal(selection.candidateDiagnostics[0]?.chunkId, null);
  assert.equal(typeof selection.candidateDiagnostics[0]?.entityTermCount, "number");
  assert.doesNotThrow(() => JSON.stringify(logs));
  assert.doesNotMatch(JSON.stringify(logs), /Parking is available behind the building/);
});

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

test(
  "service capability questions preserve service intent and attribute when a branch or offer verb is present",
  () => {
    const serviceEvidence: KnowledgeContextItem = {
      id: "northside-physiotherapy-chunk",
      knowledgeSourceId: "northside-service-source",
      providerDocumentId: "northside-service-document",
      title: "Northside Branch Services",
      sourceType: "rich_text",
      content: "Northside Branch services include physiotherapy.",
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const cases = [
      "Does the Northside branch provide physiotherapy?",
      "Does the Northside branch offer physiotherapy?",
      "Do you offer physiotherapy?",
    ];

    for (const query of cases) {
      const result = selectKnowledgeForAnswer(query, [serviceEvidence]);

      assert.equal(result.analysis.intent, "services", query);
      assert.deepEqual(result.attributeCoverage.requested, [
        { intent: "services", attribute: "service" },
      ]);
      assert.deepEqual(result.attributeCoverage.covered, [
        { intent: "services", attribute: "service" },
      ]);
      assert.deepEqual(result.attributeCoverage.missing, []);
      assert.equal(result.selected.length, 1);
    }

    const promotionQuery =
      "Does the Northside branch offer promotions for physiotherapy?";
    const explicitPromotion = selectKnowledgeForAnswer(
      promotionQuery,
      [serviceEvidence],
    );
    assert.equal(explicitPromotion.analysis.intent, "promotion");
    assert.deepEqual(explicitPromotion.attributeCoverage.missing, [
      { intent: "promotion", attribute: "promotion" },
    ]);
    assert.equal(explicitPromotion.selected.length, 0);
  },
);

test(
  "branch identity and service evidence alone do not satisfy an address request",
  () => {
    const serviceEvidence: KnowledgeContextItem = {
      id: "northside-service-only-chunk",
      knowledgeSourceId: "northside-service-only-source",
      providerDocumentId: "northside-service-only-document",
      title: "Northside Branch Information",
      sourceType: "rich_text",
      content: "Northside Branch services include physiotherapy.",
      score: 0.95,
      rerankerScore: 0.95,
      retrievalMethod: "hybrid",
    };
    const result = selectKnowledgeForAnswer(
      "What is the Northside branch address?",
      [serviceEvidence],
    );
    const candidate = result.candidateDiagnostics[0];

    assert.equal(result.analysis.intent, "location");
    assert.equal(result.selected.length, 1);
    assert.equal(result.attributeCoverage.covered.length, 0);
    assert.deepEqual(result.attributeCoverage.missing, [
      { intent: "location", attribute: "location" },
    ]);
    assert.equal(candidate?.requestedAttributeSupport[0]?.attributeEvidence, false);
    assert.equal(candidate?.requestedAttributeSupport[0]?.supported, false);
  },
);


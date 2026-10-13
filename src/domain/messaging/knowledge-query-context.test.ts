import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveKnowledgeQuery,
} from "./knowledge-query-context";

import type {
  KnowledgeQueryHistoryItem,
} from "./knowledge-query-context";

const currentQueryAt = "2026-10-11T15:01:00.000Z";

const previousBranchQuestion: KnowledgeQueryHistoryItem = {
  role: "customer",
  text: "Can I get Kota Kemuning address?",
  timestamp: "2026-10-11T15:00:00.000Z",
};

const branchContactClarification =
  "Do you mean the general contact number, or the number for a specific branch? If it’s for a branch, please tell me which one.";

test(
  "resolves a Google location link follow-up using the previous branch",
  () => {
    const result = resolveKnowledgeQuery(
      "Can I get google location link",
      [previousBranchQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, true);
    assert.match(result.retrievalQuery, /Kota Kemuning/i);
    assert.match(result.retrievalQuery, /google location link/i);
    assert.ok(result.contextSource);
    assert.match(result.contextSource, /Kota Kemuning/i);
  },
);

test(
  "does not reuse the previous branch for an unrelated question",
  () => {
    const result = resolveKnowledgeQuery(
      "What services does Poliklinik Shaik provide?",
      [previousBranchQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, false);
    assert.equal(
      result.retrievalQuery,
      "What services does Poliklinik Shaik provide?",
    );
  },
);

test(
  "does not infer a branch when conversation history is missing",
  () => {
    const query = "Can I get google location link";

    const result = resolveKnowledgeQuery(
      query,
      [],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, false);
    assert.equal(result.retrievalQuery, query);
  },
);

test(
  "does not reuse expired branch context",
  () => {
    const expiredBranchQuestion: KnowledgeQueryHistoryItem = {
      role: "customer",
      text: "Can I get Kota Kemuning address?",
      timestamp: "2026-10-10T01:00:00.000Z",
    };

    const query = "Can I get google location link";

    const result = resolveKnowledgeQuery(
      query,
      [expiredBranchQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, false);
    assert.equal(result.retrievalQuery, query);
  },
);

test(
  "resolves Google location without the word link",
  () => {
    const result = resolveKnowledgeQuery(
      "Can you give me google location",
      [previousBranchQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, true);
    assert.match(
      result.retrievalQuery,
      /Kota Kemuning/i,
    );
  },
);

test(
  "uses branch context for an opening-hours follow-up",
  () => {
    const result = resolveKnowledgeQuery(
      "Is the clinic open on Sunday?",
      [previousBranchQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, true);
    assert.match(
      result.retrievalQuery,
      /Kota Kemuning/i,
    );
  },
);

test("resolves a dependent contact-number follow-up using the recent branch", () => {
  const result = resolveKnowledgeQuery(
    "And its contact number?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, true);
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.retrievalQuery, /contact number/i);
  assert.equal(result.clarificationQuestion, undefined);
});

test("resolves a mobile-number follow-up using the recent branch", () => {
  const result = resolveKnowledgeQuery(
    "What about the mobile number?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, true);
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.retrievalQuery, /mobile number/i);
});

test("asks clarification for a standalone contact question after a branch question", () => {
  const result = resolveKnowledgeQuery(
    "What is your contact number?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, false);
  assert.equal(result.clarificationQuestion, branchContactClarification);
  assert.equal(result.retrievalQuery, "What is your contact number?");
});

test("an explicit branch in a standalone contact question needs no clarification", () => {
  const result = resolveKnowledgeQuery(
    "What is the contact number for Kota Kemuning?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.contextUsed, false);
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
});

test("a branch answer after clarification retains the requested contact attribute", () => {
  const result = resolveKnowledgeQuery(
    "Kota Kemuning",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, true);
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.retrievalQuery, /contact number/i);
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.analysisQuery ?? "", /Kota Kemuning/i);
  assert.match(result.analysisQuery ?? "", /contact number/i);
});

test("resolves 'the earlier branch' to one uniquely named branch after clarification", () => {
  const result = resolveKnowledgeQuery(
    "the earlier branch",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, true);
  assert.equal(result.contextSource, "resolved_branch_clarification");
  assert.match(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.retrievalQuery, /contact number/i);
  assert.match(result.analysisQuery ?? "", /Kota Kemuning/i);
  assert.match(result.analysisQuery ?? "", /contact number/i);
  assert.equal(result.clarificationQuestion, undefined);
});

test("asks which branch when a referential clarification has multiple branch candidates", () => {
  const result = resolveKnowledgeQuery(
    "the earlier branch",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "Can I get Shah Alam address?",
        timestamp: "2026-10-11T15:00:15.000Z",
      },
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, undefined);
  assert.equal(result.clarificationQuestion, "Which branch do you mean? Please name its location.");
  assert.equal(result.contextUsed, false);
});

test("a conversational acknowledgement is not treated as a branch clarification answer", () => {
  const result = resolveKnowledgeQuery(
    "Thanks",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, undefined);
  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.contextUsed, false);
});

test("an explicit branch answer resolves the pending request and overrides earlier branch context", () => {
  const result = resolveKnowledgeQuery(
    "Shah Alam",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, true);
  assert.match(result.retrievalQuery, /Shah Alam/i);
  assert.doesNotMatch(result.retrievalQuery, /Kota Kemuning/i);
  assert.match(result.analysisQuery ?? "", /contact number/i);
});

test("an explicit different branch overrides earlier branch context after clarification", () => {
  const result = resolveKnowledgeQuery(
    "Shah Alam",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What is your contact number?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
      {
        role: "ai",
        text: branchContactClarification,
        timestamp: "2026-10-11T15:00:45.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, true);
  assert.match(result.retrievalQuery, /Shah Alam/i);
  assert.match(result.retrievalQuery, /contact number/i);
  assert.doesNotMatch(result.retrievalQuery, /Kota Kemuning/i);
});

test("an unrelated topic is not included in branch retrieval context", () => {
  const result = resolveKnowledgeQuery(
    "What services do you provide?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, false);
  assert.equal(result.clarificationQuestion, undefined);
  assert.doesNotMatch(result.retrievalQuery, /Kota Kemuning/i);
});

test("a contact question after a topic change does not revive an older branch", () => {
  const result = resolveKnowledgeQuery(
    "What is your contact number?",
    [
      previousBranchQuestion,
      {
        role: "customer",
        text: "What services do you provide?",
        timestamp: "2026-10-11T15:00:30.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, false);
  assert.equal(result.clarificationQuestion, undefined);
});

test("an expired branch does not cause contact clarification or context reuse", () => {
  const result = resolveKnowledgeQuery(
    "What is your contact number?",
    [
      {
        ...previousBranchQuestion,
        timestamp: "2026-10-10T01:00:00.000Z",
      },
    ],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, false);
  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.retrievalQuery, "What is your contact number?");
});

test("explicit topic reset suppresses branch context and clarification", () => {
  const result = resolveKnowledgeQuery(
    "New question: What is your contact number?",
    [previousBranchQuestion],
    currentQueryAt,
  );

  assert.equal(result.contextUsed, false);
  assert.equal(result.clarificationQuestion, undefined);
});

test("a short reply without the outstanding clarification is not treated as its answer", () => {
  const unrelatedConversationHistory: KnowledgeQueryHistoryItem[] = [
    previousBranchQuestion,
  ];
  const result = resolveKnowledgeQuery(
    "Kota Kemuning",
    unrelatedConversationHistory,
    currentQueryAt,
  );

  assert.equal(result.clarificationResolved, undefined);
  assert.doesNotMatch(result.retrievalQuery, /contact number/i);
});

test(
  "does not carry hotel context into a clinic-hours question",
  () => {
    const hotelQuestion: KnowledgeQueryHistoryItem = {
      role: "customer",
      text: "Which hotel has accommodation near the airport?",
      timestamp: "2026-10-11T15:00:00.000Z",
    };

    const result = resolveKnowledgeQuery(
      "Is the clinic open on Sunday?",
      [hotelQuestion],
      currentQueryAt,
    );

    assert.equal(result.contextUsed, false);
    assert.equal(
      result.retrievalQuery,
      "Is the clinic open on Sunday?",
    );
  },
);

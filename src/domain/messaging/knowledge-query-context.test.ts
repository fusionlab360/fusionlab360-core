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
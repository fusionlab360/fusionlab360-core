
import test from "node:test";
import assert from "node:assert/strict";

import {
  selectRelevantKnowledgeMatches,
} from "./relevance-policy";

test("weak reranker score cannot be overridden by high vector score", () => {
  const weakReranker = {
    content: "Not relevant to the question.",
    score: 0.91,
    rerankerScore: -1,
  };

  const strongReranker = {
    content: "Evidence relevant to the question.",
    score: 0.32,
    rerankerScore: 1.2,
  };

  const selected = selectRelevantKnowledgeMatches([
    weakReranker,
    strongReranker,
  ]);

  assert.deepEqual(selected, [strongReranker]);
});

test("vector threshold is used when reranker scores are unavailable", () => {
  const accepted = {
    content: "Relevant vector candidate.",
    score: 0.7,
  };

  const rejected = {
    content: "Weak vector candidate.",
    score: 0.64,
  };

  const selected = selectRelevantKnowledgeMatches([
    accepted,
    rejected,
  ]);

  assert.deepEqual(selected, [accepted]);
});

test("unscored candidates are excluded when reranker scores exist", () => {
  const scored = {
    content: "Relevant evidence.",
    score: 0.2,
    rerankerScore: 1,
  };

  const unscored = {
    content: "Unscored evidence.",
    score: 0.95,
  };

  const selected = selectRelevantKnowledgeMatches([
    scored,
    unscored,
  ]);

  assert.deepEqual(selected, [scored]);
});

test("empty evidence is rejected even when scores are high", () => {
  const selected = selectRelevantKnowledgeMatches([
    {
      content: "   ",
      score: 0.99,
      rerankerScore: 2,
    },
  ]);

  assert.deepEqual(selected, []);
});

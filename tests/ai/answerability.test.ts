import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCoreAIAnswerability,
} from "../../src/domain/messaging/ai-chat-service";

test(
  "answers the supported part when intent coverage is partial",
  () => {
    const result = resolveCoreAIAnswerability(
      true,
      true,
      "partial",
      "none",
      true,
    );

    assert.equal(result.decision, "answer_partial");
    assert.equal(result.confidence, "medium");
    assert.equal(result.reason, "partial_knowledge_coverage");
  },
);

test(
  "allows a grounded partial answer when requested attributes are unsupported",
  () => {
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
  },
);

test(
  "hands off when no requested intent is covered",
  () => {
    const result = resolveCoreAIAnswerability(
      true,
      true,
      "none",
      "partial",
      true,
    );

    assert.equal(result.decision, "handoff");
    assert.equal(result.reason, "no_requested_intent_coverage");
  },
);

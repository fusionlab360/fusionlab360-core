import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RETRIEVAL_EVALUATION_CASES,
} from "../../../src/domain/messaging/retrieval-evaluation-cases";

test("evaluation benchmark contains 25 questions", () => {
  assert.equal(RETRIEVAL_EVALUATION_CASES.length, 25);
});

test("every evaluation case has a unique ID and a question", () => {
  const ids = RETRIEVAL_EVALUATION_CASES.map(
    (item) => item.id,
  );

  assert.equal(new Set(ids).size, ids.length);

  for (const item of RETRIEVAL_EVALUATION_CASES) {
    assert.ok(item.id.trim().length > 0);
    assert.ok(item.question.trim().length > 0);
    assert.ok(item.expectedIntents.length > 0);
    assert.ok(item.labelNote.trim().length > 0);
  }
});

test("answerable cases define supporting and required evidence", () => {
  for (const item of RETRIEVAL_EVALUATION_CASES) {
    if (!item.expectedAnswerable) {
      continue;
    }

    assert.ok(
      item.relevantSourceKeys.length > 0,
      `${item.id} needs relevant source labels`,
    );

    assert.ok(
      item.requiredSourceKeys.length > 0,
      `${item.id} needs required source labels`,
    );

    for (const key of item.requiredSourceKeys) {
      assert.ok(
        item.relevantSourceKeys.includes(key),
        `${item.id}: required key ${key} must also be relevant`,
      );
    }
  }
});

test("unanswerable cases do not claim supporting evidence", () => {
  for (const item of RETRIEVAL_EVALUATION_CASES) {
    if (item.expectedAnswerable) {
      continue;
    }

    assert.deepEqual(
      item.relevantSourceKeys,
      [],
      `${item.id} must not claim a supporting source`,
    );

    assert.deepEqual(
      item.requiredSourceKeys,
      [],
      `${item.id} must not require an answer source`,
    );
  }
});

test("benchmark covers English, Malay, Chinese, and mixed language", () => {
  const languages = new Set(
    RETRIEVAL_EVALUATION_CASES.map(
      (item) => item.language,
    ),
  );

  assert.ok(languages.has("en"));
  assert.ok(languages.has("ms"));
  assert.ok(languages.has("zh"));
  assert.ok(languages.has("mixed"));
});

test("benchmark includes answerable and unanswerable cases", () => {
  assert.ok(
    RETRIEVAL_EVALUATION_CASES.some(
      (item) => item.expectedAnswerable,
    ),
  );

  assert.ok(
    RETRIEVAL_EVALUATION_CASES.some(
      (item) => !item.expectedAnswerable,
    ),
  );
});

test("compound questions require every supporting source", () => {
  const compound = RETRIEVAL_EVALUATION_CASES.find(
    (item) => item.id === "clinic-010",
  );

  assert.ok(compound);
  assert.equal(compound.category, "compound");

  assert.deepEqual(
    new Set(compound.requiredSourceKeys),
    new Set(["hours:general", "services:general"]),
  );

  assert.equal(compound.requiredSourceKeys.length, 2);
});

test("all labels remain provisional until reviewed", () => {
  assert.ok(
    RETRIEVAL_EVALUATION_CASES.every(
      (item) => item.reviewStatus === "draft",
    ),
  );
});
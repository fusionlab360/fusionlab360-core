import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAndVerifyEvidenceAnswer,
  type EvidenceSource,
} from "../../../src/core/ai/evidence-answer";

const sources: EvidenceSource[] = [
  {
    id: "K1",
    title: "Opening hours",
    sourceType: "rich_text",
    content: "The clinic is open from 9 AM to 6 PM.",
  },
];

test("accepts a valid answer with a matching evidence quote", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer: "The clinic is open from 9 AM to 6 PM.",
      claims: [
        {
          text: "The clinic is open from 9 AM to 6 PM.",
          chunk_id: "K1",
          quote: "The clinic is open from 9 AM to 6 PM.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, true);
  assert.equal(result.status, "full");
  assert.deepEqual(result.evidenceIds, ["K1"]);
});

test("rejects a claim citing an unknown evidence ID", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer: "The clinic is open 24 hours.",
      claims: [
        {
          text: "The clinic is open 24 hours.",
          chunk_id: "K9",
          quote: "The clinic is open from 9 AM to 6 PM.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.evidenceIds, []);
});

test("rejects a quote that is not present in its source", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer: "The clinic is open 24 hours.",
      claims: [
        {
          text: "The clinic is open 24 hours.",
          chunk_id: "K1",
          quote: "Open 24 hours every day.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, false);
});


test("rejects an answer containing an unsupported extra sentence", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer:
        "The clinic is open from 9 AM to 6 PM. " +
        "Walk-ins are always accepted.",
      claims: [
        {
          text: "The clinic is open from 9 AM to 6 PM.",
          chunk_id: "K1",
          quote: "The clinic is open from 9 AM to 6 PM.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.includes("answer_sentence_2_missing_claim"),
  );
  assert.deepEqual(result.evidenceIds, []);
});

test("rejects a claim that covers only part of an answer sentence", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer: "The clinic is open from 9 AM to 6 PM.",
      claims: [
        {
          text: "The clinic is open",
          chunk_id: "K1",
          quote: "The clinic is open from 9 AM to 6 PM.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.includes(
      "claim_1_text_not_exact_answer_sentence",
    ),
  );
});


test("rejects a claim that changes a price from its source", () => {
  const priceSources: EvidenceSource[] = [
    {
      id: "K1",
      title: "Consultation fee",
      sourceType: "rich_text",
      content: "A consultation costs RM100.",
    },
  ];

  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "full",
      answer: "A consultation costs RM200.",
      claims: [
        {
          text: "A consultation costs RM200.",
          chunk_id: "K1",
          quote: "A consultation costs RM100.",
        },
      ],
    }),
    priceSources,
  );

  assert.equal(result.valid, false);

  assert.ok(
    result.errors.includes(
      "claim_1_critical_fact_not_in_quote",
    ),
  );

  assert.deepEqual(result.evidenceIds, []);
});


test("accepts a valid partial answer and preserves its status", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "partial",
      answer: "The clinic is open from 9 AM to 6 PM.",
      claims: [
        {
          text: "The clinic is open from 9 AM to 6 PM.",
          chunk_id: "K1",
          quote: "The clinic is open from 9 AM to 6 PM.",
        },
      ],
    }),
    sources,
  );

  assert.equal(result.valid, true);
  assert.equal(result.status, "partial");
  assert.equal(
    result.answer,
    "The clinic is open from 9 AM to 6 PM.",
  );
  assert.deepEqual(result.evidenceIds, ["K1"]);
});

test("accepts a valid no-answer response without evidence claims", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "none",
      answer: "",
      claims: [],
    }),
    sources,
  );

  assert.equal(result.valid, true);
  assert.equal(result.status, "none");
  assert.equal(result.answer, "");
  assert.deepEqual(result.evidenceIds, []);
});

test("rejects a no-answer status that contains an answer", () => {
  const result = parseAndVerifyEvidenceAnswer(
    JSON.stringify({
      status: "none",
      answer: "The clinic is open from 9 AM to 6 PM.",
      claims: [],
    }),
    sources,
  );

  assert.equal(result.valid, false);
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.evidenceIds, []);
});


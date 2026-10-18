import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvaluateRetrievalController,
  evaluateRetrievalController,
} from "./retrieval-evaluation-controller";

import {
  createTenantKnowledgeRetriever,
} from "./tenant-knowledge-retriever";

import {
  runRetrievalEvaluation,
} from "./retrieval-evaluation-runner";

function createMockContext(
  body: unknown,
  invalidJson = false,
): Parameters<typeof evaluateRetrievalController>[0] {
  return {
    req: {
      json: async () => {
        if (invalidJson) {
          throw new Error("Invalid JSON");
        }

        return body;
      },
    },
    env: {},
    get: (key: string) => {
      assert.equal(key, "context");

      return {
        tenant: {
          id: "tenant-test",
        },
      };
    },
    json: (payload: unknown, status?: number) =>
      Response.json(payload, {
        status: status ?? 200,
      }),
  } as unknown as Parameters<
    typeof evaluateRetrievalController
  >[0];
}

test("rejects malformed JSON without creating a retriever", async () => {
  let retrieverCreated = false;

  const handler = createEvaluateRetrievalController({
    createRetriever: (() => {
      retrieverCreated = true;
      throw new Error("Must not be called");
    }) as unknown as typeof createTenantKnowledgeRetriever,
  });

  const response = await handler(
    createMockContext(undefined, true),
  );

  assert.equal(response.status, 400);
  assert.equal(retrieverCreated, false);

  assert.deepEqual(await response.json(), {
    success: false,
    message: "A valid JSON request body is required.",
  });
});

test("rejects an invalid source mapping without running evaluation", async () => {
  let evaluationCalled = false;

  const handler = createEvaluateRetrievalController({
    runEvaluation: (async () => {
      evaluationCalled = true;
      throw new Error("Must not be called");
    }) as typeof runRetrievalEvaluation,
  });

  const response = await handler(
    createMockContext({
      sourceKeyById: ["invalid"],
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(evaluationCalled, false);

  assert.deepEqual(await response.json(), {
    success: false,
    message:
      "sourceKeyById must be an object mapping real source IDs to logical evaluation keys.",
  });
});

test("returns diagnostics only for a draft case without running real retrieval", async () => {
  let capturedReviewStatuses: string[] = [];

  let capturedSourceKeyById:
    Readonly<Record<string, string>> = {};

  const handler = createEvaluateRetrievalController({
    createRetriever: (() =>
      ({
        search: async () => [],
      })) as unknown as typeof createTenantKnowledgeRetriever,

    runEvaluation: async (options) => {
      const cases = options.cases ?? [];

      capturedReviewStatuses = cases.map(
        (testCase) => testCase.reviewStatus,
      );

      capturedSourceKeyById = options.sourceKeyById;

      return {
        cases: cases.map((testCase) => ({
          caseId: testCase.id,
          question: testCase.question,
          reviewStatus: testCase.reviewStatus,
        })),
        summary: null,
      } as unknown as Awaited<
        ReturnType<typeof runRetrievalEvaluation>
      >;
    },
  });

  const response = await handler(
    createMockContext({
      caseIds: ["clinic-001"],
      sourceKeyById: {
        "document-fixture": "services:general",
      },
      retrievalTopK: 10,
      metricK: 5,
    }),
  );

  assert.equal(response.status, 200);

  const payload = await response.json() as {
    success: boolean;
    scoringStatus: string;
    casesRun: number;
    verifiedCasesEvaluated: number;
    summary: unknown;
    cases: Array<{
      caseId: string;
      reviewStatus: string;
    }>;
  };

  assert.equal(payload.success, true);

  assert.equal(
    payload.scoringStatus,
    "diagnostics_only_no_verified_cases",
  );

  assert.equal(payload.casesRun, 1);
  assert.equal(payload.verifiedCasesEvaluated, 0);
  assert.equal(payload.summary, null);

  assert.deepEqual(capturedReviewStatuses, ["draft"]);

  assert.equal(
    capturedSourceKeyById["document-fixture"],
    "services:general",
  );

  assert.equal(payload.cases[0]?.caseId, "clinic-001");
  assert.equal(payload.cases[0]?.reviewStatus, "draft");
});
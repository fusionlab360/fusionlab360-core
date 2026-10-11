import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  createTenantKnowledgeRetriever,
} from "./tenant-knowledge-retriever";

import {
  RETRIEVAL_EVALUATION_CASES,
} from "./retrieval-evaluation-cases";

import {
  runRetrievalEvaluation,
} from "./retrieval-evaluation-runner";

interface RetrievalEvaluationRequest {
  caseIds?: unknown;
  sourceKeyById?: unknown;
  retrievalTopK?: unknown;
  metricK?: unknown;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseSourceKeyMap(
  value: unknown,
): Record<string, string> | null {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (entries.length > 1000) {
    return null;
  }

  const result: Record<string, string> = Object.create(null);

  for (const [rawId, rawKey] of entries) {
    const id = rawId.trim();

    if (
      !id ||
      id.length > 512 ||
      typeof rawKey !== "string" ||
      !rawKey.trim() ||
      rawKey.trim().length > 200
    ) {
      return null;
    }

    result[id] = rawKey.trim();
  }

  return result;
}

function parseCaseIds(
  value: unknown,
): string[] | null {
  if (value === undefined) {
    return RETRIEVAL_EVALUATION_CASES.map(
      (testCase) => testCase.id,
    );
  }

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > RETRIEVAL_EVALUATION_CASES.length
  ) {
    return null;
  }

  const validIds = new Set(
    RETRIEVAL_EVALUATION_CASES.map(
      (testCase) => testCase.id,
    ),
  );

  if (
    !value.every(
      (id): id is string =>
        typeof id === "string" &&
        validIds.has(id),
    )
  ) {
    return null;
  }

  if (new Set(value).size !== value.length) {
    return null;
  }

  return value;
}

function parseBoundedInteger(
  value: unknown,
  defaultValue: number,
  maximum: number,
): number | null {
  if (value === undefined) {
    return defaultValue;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const integer = Math.floor(value);

  if (integer < 1 || integer > maximum) {
    return null;
  }

  return integer;
}

export async function evaluateRetrievalController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  let body: unknown;

  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json(
      {
        success: false,
        message: "A valid JSON request body is required.",
      },
      400,
    );
  }

  if (!isRecord(body)) {
    return c.json(
      {
        success: false,
        message: "The request body must be a JSON object.",
      },
      400,
    );
  }

  const request =
    body as RetrievalEvaluationRequest;

  const sourceKeyById = parseSourceKeyMap(
    request.sourceKeyById,
  );

  if (!sourceKeyById) {
    return c.json(
      {
        success: false,
        message:
          "sourceKeyById must be an object mapping real source IDs to logical evaluation keys.",
      },
      400,
    );
  }

  const caseIds = parseCaseIds(request.caseIds);

  if (!caseIds) {
    return c.json(
      {
        success: false,
        message:
          "caseIds must contain unique IDs from the configured evaluation benchmark.",
      },
      400,
    );
  }

  const retrievalTopK = parseBoundedInteger(
    request.retrievalTopK,
    20,
    20,
  );

  const metricK = parseBoundedInteger(
    request.metricK,
    5,
    20,
  );

  if (
    retrievalTopK === null ||
    metricK === null ||
    metricK > retrievalTopK
  ) {
    return c.json(
      {
        success: false,
        message:
          "retrievalTopK and metricK must be integers from 1 to 20, with metricK no greater than retrievalTopK.",
      },
      400,
    );
  }

  const selectedCases =
    RETRIEVAL_EVALUATION_CASES.filter(
      (testCase) => caseIds.includes(testCase.id),
    );

  const requestContext = c.get("context");

  const retriever = createTenantKnowledgeRetriever({
    ai: c.env.AI,
    vectorize: c.env.VECTORIZE_V2,
    tenantId: requestContext.tenant.id,
    db: c.env.DB,
    topK: retrievalTopK,
  });

  try {
    const evaluation = await runRetrievalEvaluation({
      retriever,
      sourceKeyById,
      cases: selectedCases,
      topK: metricK,
    });

    return c.json({
      success: true,

      evaluationMode: "retrieval_and_selection_only",

      scoringStatus: evaluation.summary
        ? "verified_cases_scored"
        : "diagnostics_only_no_verified_cases",

      casesRun: evaluation.cases.length,
      verifiedCasesEvaluated:
        evaluation.summary?.verifiedCasesEvaluated ?? 0,

      summary: evaluation.summary,

      cases: evaluation.cases,
    });
  } catch (error: unknown) {
    console.error(
      "Knowledge retrieval evaluation failed.",
      {
        tenantId: requestContext.tenant.id,
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      },
    );

    return c.json(
      {
        success: false,
        message:
          "Knowledge retrieval evaluation failed.",
      },
      500,
    );
  }
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  handleError,
} from "../../src/bootstrap/error";

test("unhandled errors return a generic response without provider details", async () => {
  const sensitiveMessage =
    "Gemini provider failed; api_key=example-sensitive-value";

  const response = handleError(
    new Error(sensitiveMessage),
  );

  assert.equal(response.status, 500);

  const body = await response.json() as {
    success: boolean;
    message: string;
    details?: unknown;
  };

  assert.equal(body.success, false);
  assert.equal(body.message, "Internal Server Error");
  assert.equal("details" in body, false);

  const serializedBody = JSON.stringify(body);

  assert.equal(
    serializedBody.includes("example-sensitive-value"),
    false,
  );

  assert.equal(
    serializedBody.includes("Gemini provider failed"),
    false,
  );
});

test("unknown thrown values do not appear in the response", async () => {
  const response = handleError(
    "sensitive internal provider details",
  );

  assert.equal(response.status, 500);

  const body = await response.json() as {
    success: boolean;
    message: string;
  };

  assert.equal(body.success, false);
  assert.equal(body.message, "Internal Server Error");

  assert.equal(
    JSON.stringify(body).includes(
      "sensitive internal provider details",
    ),
    false,
  );
});

test("ApiError response and production log contain only allowlisted fields", async () => {
  const { ApiError } = await import("../../src/core/errors/ApiError");
  const captured: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => captured.push(args);
  let response: Response;
  try {
    response = handleError(new ApiError(
      502,
      "Provider response included customer@example.test and access_token=synthetic-secret",
      { body: "private provider response", authorization: "Bearer synthetic-secret" },
      "UPSTREAM_FAILURE",
    ));
  } finally {
    console.log = originalLog;
  }

  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 502);
  assert.deepEqual(Object.keys(body).sort(), ["code", "correlationId", "message", "success"]);
  assert.equal(body.success, false);
  assert.equal(body.message, "Internal Server Error");
  assert.equal(body.code, "UPSTREAM_FAILURE");
  assert.equal(typeof body.correlationId, "string");
  assert.equal(response.headers.get("X-Correlation-ID"), body.correlationId);

  const serialized = `${JSON.stringify(body)} ${JSON.stringify(captured)}`;
  for (const sensitive of ["customer@example.test", "synthetic-secret", "private provider response", "authorization"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

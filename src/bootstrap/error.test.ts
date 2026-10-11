
import test from "node:test";
import assert from "node:assert/strict";

import {
  handleError,
} from "./error";

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

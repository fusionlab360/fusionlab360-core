
import test from "node:test";
import assert from "node:assert/strict";

import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "./contracts";

import {
  generateValidatedResponse,
} from "./validated-generation";

function mockResponse(text: string): AIChatResponse {
  return {
    text,
    provider: "mock",
    model: "mock-model",
  };
}

function createRequest(): AIChatRequest {
  return {
    task: "structured",
    messages: [
      {
        role: "system",
        content: "Return structured output.",
      },
      {
        role: "user",
        content: "Answer the question.",
      },
    ],
    maxTokens: 350,
    temperature: 0.2,
  };
}

function validateText(response: AIChatResponse) {
  return {
    valid: response.text === "valid",
    value: response.text,
    reason:
      response.text === "valid"
        ? undefined
        : "output_failed_validation",
  };
}

test("returns a valid first response without retrying", async () => {
  let calls = 0;

  const provider: AIProvider = {
    async chat() {
      calls += 1;
      return mockResponse("valid");
    },
  };

  const result = await generateValidatedResponse({
    provider,
    request: createRequest(),
    validate: validateText,
    correctionInstruction: "Correct the invalid output.",
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.fallbackUsed, false);
  assert.equal(calls, 1);
});

test("uses provider fallback for one invalid response", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  let fallbackRequest: AIChatRequest | undefined;

  const provider: AIProvider = {
    async chat() {
      primaryCalls += 1;
      return mockResponse("invalid");
    },

    async chatFallback(request) {
      fallbackCalls += 1;
      fallbackRequest = request;
      return mockResponse("valid");
    },
  };

  const result = await generateValidatedResponse({
    provider,
    request: createRequest(),
    validate: validateText,
    correctionInstruction:
      "Return valid structured output.",
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.fallbackUsed, true);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);

  assert.ok(fallbackRequest);

  assert.ok(
    fallbackRequest.messages[0].content.includes(
      "VALIDATION CORRECTION",
    ),
  );
});

test("does not exceed one corrective retry", async () => {
  let calls = 0;

  const provider: AIProvider = {
    async chat() {
      calls += 1;
      return mockResponse("invalid");
    },
  };

  const result = await generateValidatedResponse({
    provider,
    request: createRequest(),
    validate: validateText,
    correctionInstruction: "Correct the invalid output.",
    maxValidationRetries: 10,
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("preserves the invalid result when fallback fails", async () => {
  const provider: AIProvider = {
    async chat() {
      return mockResponse("invalid");
    },

    async chatFallback() {
      throw new Error("Fallback unavailable");
    },
  };

  const result = await generateValidatedResponse({
    provider,
    request: createRequest(),
    validate: validateText,
    correctionInstruction: "Correct the invalid output.",
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.response.text, "invalid");
  assert.equal(result.attempts, 2);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.retryError, "Fallback unavailable");
});


test("recovers through fallback when the primary provider throws", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const provider: AIProvider = {
    async chat() {
      primaryCalls += 1;
      throw new Error("Primary unavailable");
    },

    async chatFallback() {
      fallbackCalls += 1;
      return mockResponse("valid");
    },
  };

  const result = await generateValidatedResponse({
    provider,
    request: createRequest(),
    validate: validateText,
    correctionInstruction: "Return valid output.",
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.response.text, "valid");
  assert.equal(result.attempts, 2);
  assert.equal(result.fallbackUsed, true);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test("propagates an error when both primary and fallback providers throw", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const provider: AIProvider = {
    async chat() {
      primaryCalls += 1;
      throw new Error("Primary unavailable");
    },

    async chatFallback() {
      fallbackCalls += 1;
      throw new Error("Fallback unavailable");
    },
  };

  await assert.rejects(
    () =>
      generateValidatedResponse({
        provider,
        request: createRequest(),
        validate: validateText,
        correctionInstruction: "Return valid output.",
      }),
    /Primary AI provider failed: Primary unavailable; Fallback AI provider failed: Fallback unavailable/,
  );

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
});


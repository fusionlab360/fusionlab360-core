
import test from "node:test";
import assert from "node:assert/strict";

import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../contracts";

import {
  HybridAIProvider,
} from "./hybrid";

function createMockProvider(
  name: string,
  calls: string[],
): AIProvider {
  return {
    async chat(
      request: AIChatRequest,
    ): Promise<AIChatResponse> {
      calls.push(`${name}:${request.task ?? "default"}`);

      return {
        text: `${name} response`,
        provider: name,
        model: `${name}-model`,
      };
    },
  };
}

function createRequest(
  task?: AIChatRequest["task"],
): AIChatRequest {
  return {
    ...(task ? { task } : {}),
    messages: [
      {
        role: "user",
        content: "Test request",
      },
    ],
  };
}

test("structured tasks use Cloudflare first and Gemini as fallback", async () => {
  const calls: string[] = [];

  const hybrid = new HybridAIProvider(
    createMockProvider("cloudflare", calls),
    createMockProvider("gemini", calls),
  );

  const request = createRequest("structured");

  const primary = await hybrid.chat(request);
  const fallback = await hybrid.chatFallback!(request);

  assert.equal(primary.provider, "cloudflare");
  assert.equal(fallback.provider, "gemini");

  assert.deepEqual(calls, [
    "cloudflare:structured",
    "gemini:structured",
  ]);
});

test("response tasks use Gemini first and Cloudflare as fallback", async () => {
  const calls: string[] = [];

  const hybrid = new HybridAIProvider(
    createMockProvider("cloudflare", calls),
    createMockProvider("gemini", calls),
  );

  const request = createRequest("response");

  const primary = await hybrid.chat(request);
  const fallback = await hybrid.chatFallback!(request);

  assert.equal(primary.provider, "gemini");
  assert.equal(primary.fallbackUsed, false);
  assert.deepEqual(primary.providerAttempts?.map(({ provider, outcome }) => ({ provider, outcome })), [
    { provider: "gemini", outcome: "success" },
  ]);
  assert.equal(fallback.provider, "cloudflare");

  assert.deepEqual(calls, [
    "gemini:response",
    "cloudflare:response",
  ]);
});

test("provider failure records a bounded fallback attempt and marks fallback used", async () => {
  const calls: string[] = [];
  const gemini: AIProvider = {
    async chat() {
      calls.push("gemini");
      throw new TypeError("network failure details must not be logged");
    },
  };
  const cloudflare = createMockProvider("cloudflare", calls);
  const originalWarn = console.warn;
  console.warn = (() => undefined) as typeof console.warn;
  try {
    const response = await new HybridAIProvider(cloudflare, gemini).chat(createRequest("response"));
    assert.equal(response.provider, "cloudflare");
    assert.equal(response.fallbackUsed, true);
    assert.deepEqual(response.providerAttempts?.map(({ provider, outcome }) => ({ provider, outcome })), [
      { provider: "gemini", outcome: "error" },
      { provider: "cloudflare-workers-ai", outcome: "success" },
    ]);
    assert.ok(response.providerAttempts?.every(({ durationMs }) => durationMs >= 0));
  } finally {
    console.warn = originalWarn;
  }
});

test("unspecified tasks preserve Cloudflare as primary and use Gemini as fallback", async () => {
  const calls: string[] = [];

  const hybrid = new HybridAIProvider(
    createMockProvider("cloudflare", calls),
    createMockProvider("gemini", calls),
  );

  const request = createRequest();

  const primary = await hybrid.chat(request);
  const fallback = await hybrid.chatFallback!(request);

  assert.equal(primary.provider, "cloudflare");
  assert.equal(fallback.provider, "gemini");

  assert.deepEqual(calls, [
    "cloudflare:default",
    "gemini:default",
  ]);
});

test("fallback diagnostics omit provider error bodies", async () => {
  const calls: string[] = [];
  const secret = "provider-response-secret";
  const cloudflare = createMockProvider("cloudflare", calls);
  const gemini: AIProvider = {
    async chat() {
      throw new Error(`Provider response included ${secret}`);
    },
  };
  const originalWarn = console.warn;
  let warning = "";
  console.warn = ((...args: unknown[]) => {
    warning = args.map(String).join(" ");
  }) as typeof console.warn;

  try {
    const hybrid = new HybridAIProvider(cloudflare, gemini);
    await hybrid.chat(createRequest("response"));
  } finally {
    console.warn = originalWarn;
  }

  assert.match(warning, /Gemini AI failed/i);
  assert.doesNotMatch(warning, new RegExp(secret));
  assert.deepEqual(calls, ["cloudflare:response"]);
});

test("Gemini HTTP failures expose only the safe status code in attempt diagnostics", async () => {
  const calls: string[] = [];
  const gemini: AIProvider = {
    async chat() {
      calls.push("gemini");
      throw new Error("Gemini request failed with HTTP 403.");
    },
  };
  const originalWarn = console.warn;
  console.warn = (() => undefined) as typeof console.warn;
  try {
    const response = await new HybridAIProvider(
      createMockProvider("cloudflare", calls),
      gemini,
    ).chat(createRequest("reasoning"));

    assert.equal(response.fallbackUsed, true);
    const primaryAttempt = response.providerAttempts?.[0];
    assert.ok(primaryAttempt);
    assert.ok(primaryAttempt.durationMs >= 0);
    assert.deepEqual({
      provider: primaryAttempt.provider,
      outcome: primaryAttempt.outcome,
      failureKind: primaryAttempt.failureKind,
      httpStatus: primaryAttempt.httpStatus,
    }, {
      provider: "gemini",
      outcome: "error",
      failureKind: "http_response",
      httpStatus: 403,
    });
    assert.deepEqual(calls, ["gemini", "cloudflare:reasoning"]);
  } finally {
    console.warn = originalWarn;
  }
});

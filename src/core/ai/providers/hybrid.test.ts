
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
  assert.equal(fallback.provider, "cloudflare");

  assert.deepEqual(calls, [
    "gemini:response",
    "cloudflare:response",
  ]);
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

import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiAIProvider } from "./provider";

test("bounds structured Gemini fallback requests with an abort signal", async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | null | undefined;

  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | null | undefined;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: "{\"status\":\"none\",\"answer\":\"\",\"claims\":[]}" }],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const provider = createGeminiAIProvider("test-key");
    await provider.chat({
      task: "structured",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Test" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(requestSignal instanceof AbortSignal);
  assert.equal(requestSignal.aborted, false);
});

test("parses the GenerateContent response contract for response tasks", async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | null | undefined;
  let requestBody: { generationConfig?: { maxOutputTokens?: number } } | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | null | undefined;
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "The documented hours are 9 to 5." }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const provider = createGeminiAIProvider("test-key");
    const result = await provider.chat({
      task: "response",
      maxTokens: 180,
      messages: [{ role: "user", content: "What are the hours?" }],
    });
    assert.equal(result.text, "The documented hours are 9 to 5.");
    assert.equal(result.finishReason, "STOP");
    assert.equal(result.truncated, false);
    assert.equal(requestBody?.generationConfig?.maxOutputTokens, 180);
    assert.ok(requestSignal instanceof AbortSignal);
    assert.equal(requestSignal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed candidate entries fail with a controlled provider error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [null] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
  try {
    const provider = createGeminiAIProvider("test-key");
    await assert.rejects(
      provider.chat({ task: "response", messages: [{ role: "user", content: "Hi" }] }),
      (error: unknown) => error instanceof Error && error.message === "Gemini returned an empty response.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

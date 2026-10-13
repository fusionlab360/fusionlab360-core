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

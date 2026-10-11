
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudflareAIProvider,
} from "./provider";

function createMockAI(rawResponse: unknown): Ai {
  return {
    run: async () => rawResponse,
  } as unknown as Ai;
}

const request = {
  messages: [
    {
      role: "user" as const,
      content: "What are your opening hours?",
    },
  ],
  task: "response" as const,
  maxTokens: 32,
  temperature: 0,
};

test(
  "returns a truncated response when the provider exhausts its output budget",
  async () => {
    const provider = createCloudflareAIProvider(
      createMockAI({
        choices: [
          {
            message: {
              content: "",
            },
            finish_reason: "length",
          },
        ],
      }),
    );

    const response = await provider.chat(request);

    assert.equal(response.text, "");
    assert.equal(response.truncated, true);
    assert.equal(response.finishReason, "length");
  },
);

test(
  "throws when no usable text exists and the provider did not report truncation",
  async () => {
    const provider = createCloudflareAIProvider(
      createMockAI({
        choices: [
          {
            message: {
              content: "",
            },
            finish_reason: "stop",
          },
        ],
      }),
    );

    await assert.rejects(
      () => provider.chat(request),
      /no usable customer-facing text/i,
    );
  },
);

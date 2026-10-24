
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudflareAIProvider,
} from "../../../../src/integrations/ai/cloudflare/provider";

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
  "normalizes the GPT-OSS Chat Completions response shape",
  async () => {
    const provider = createCloudflareAIProvider(
      createMockAI({
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "{\"status\":\"none\",\"answer\":\"\",\"claims\":[]}",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
      }),
    );

    const response = await provider.chat({ ...request, task: "structured" });

    assert.match(response.text, /\"status\":\"none\"/);
    assert.equal(response.finishReason, "stop");
    assert.equal(response.truncated, false);
  },
);

test(
  "recognizes an incomplete GPT-OSS Responses API output",
  async () => {
    const provider = createCloudflareAIProvider(
      createMockAI({
        id: "resp_test",
        object: "response",
        status: "incomplete",
        incomplete_details: {
          reason: "max_output_tokens",
        },
        output_text: "partial",
        output: [
          {
            id: "msg_test",
            type: "message",
            role: "assistant",
            status: "incomplete",
            content: [
              {
                type: "output_text",
                text: "partial",
              },
            ],
          },
        ],
      }),
    );

    const response = await provider.chat(request);

    assert.equal(response.text, "partial");
    assert.equal(response.finishReason, "max_output_tokens");
    assert.equal(response.truncated, true);
  },
);

test("passes an abort signal to Workers AI for bounded provider execution", async () => {
  let receivedSignal: AbortSignal | undefined;
  const ai = {
    run: async (_model: string, _input: unknown, options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal;
      return { response: "A grounded test response." };
    },
  } as unknown as Ai;
  const provider = createCloudflareAIProvider(ai);
  await provider.chat({ ...request, signal: AbortSignal.timeout(60_000) });
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});

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

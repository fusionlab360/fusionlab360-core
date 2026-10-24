import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationContext } from "../../../../src/context/integration";
import { getConversationMessages, GHLConversationHistoryError } from "../../../../src/integrations/messaging/gohighlevel/messages";

function makeContext(): IntegrationContext {
  return {
    provider: "gohighlevel",
    tenant: {
      id: "tenant-test",
      integrations: { crm: { credentials: { locationId: "location-test" } } },
    },
    integrationRuntime: {
      credentials: {
        async resolve() {
          return { accessToken: "test-token", authType: "api_key" };
        },
      },
    },
  } as unknown as IntegrationContext;
}

async function withFetch(
  response: Response,
  run: (requests: Array<{ url: string; version: string | null }>) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; version: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      version: new Headers(init?.headers).get("Version"),
    });
    return response;
  }) as typeof fetch;
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("conversation history uses tenant credentials, v3, limit and the existing response envelope", async () => {
  await withFetch(new Response(JSON.stringify({
    messages: { nextPage: false, messages: [{ id: "message-test", conversationId: "conversation-test" }] },
  }), { status: 200 }), async (requests) => {
    const messages = await getConversationMessages(makeContext(), "conversation-test", 20);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "message-test");
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.url, /\/conversations\/conversation-test\/messages\?limit=20$/);
    assert.equal(requests[0]!.version, "v3");
  });
});

test("HTTP 400 is a sanitized permanent history failure", async () => {
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args);
  try {
    await withFetch(new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "private provider response" }), { status: 400 }), async () => {
      await assert.rejects(
        getConversationMessages(makeContext(), "conversation-test"),
        (error: unknown) => {
          assert.ok(error instanceof GHLConversationHistoryError);
          assert.equal(error.operation, "conversation_history");
          assert.equal(error.httpStatus, 400);
          assert.equal(error.failureKind, "provider_http");
          assert.equal(error.retryable, false);
          assert.equal(error.providerErrorCode, "INVALID_REQUEST");
          assert.equal(error.message.includes("private provider response"), false);
          return true;
        },
      );
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(JSON.stringify(logs).includes("private provider response"), false);
  assert.equal(JSON.stringify(logs).includes("test-token"), false);
});

test("429 and server failures remain retryable while authorization rejection is permanent", async () => {
  for (const [status, retryable] of [[401, false], [403, false], [429, true], [500, true], [503, true]] as const) {
    await withFetch(new Response("{}", { status }), async () => {
      await assert.rejects(
        getConversationMessages(makeContext(), "conversation-test"),
        (error: unknown) => {
          assert.ok(error instanceof GHLConversationHistoryError);
          assert.equal(error.httpStatus, status);
          assert.equal(error.retryable, retryable);
          return true;
        },
      );
    });
  }
});

test("transient history failure can recover on a later request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response("temporary provider failure", { status: 503 })
      : new Response(JSON.stringify({ messages: { messages: [] } }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      getConversationMessages(makeContext(), "conversation-test"),
      (error: unknown) => error instanceof GHLConversationHistoryError && error.retryable,
    );
    assert.deepEqual(await getConversationMessages(makeContext(), "conversation-test"), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed successful response is not normalized as empty history", async () => {
  await withFetch(new Response("not-json private response", { status: 200 }), async () => {
    await assert.rejects(
      getConversationMessages(makeContext(), "conversation-test"),
      (error: unknown) => {
        assert.ok(error instanceof GHLConversationHistoryError);
        assert.equal(error.failureKind, "malformed_response");
        assert.equal(error.retryable, true);
        assert.equal(error.message.includes("not-json"), false);
        return true;
      },
    );
  });
});

test("a fetch timeout is classified as retryable without exposing its error text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw Object.assign(new Error("private timeout details"), { name: "TimeoutError" });
  }) as typeof fetch;
  try {
    await assert.rejects(
      getConversationMessages(makeContext(), "conversation-test"),
      (error: unknown) => {
        assert.ok(error instanceof GHLConversationHistoryError);
        assert.equal(error.failureKind, "timeout");
        assert.equal(error.retryable, true);
        assert.equal(error.message.includes("private timeout details"), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

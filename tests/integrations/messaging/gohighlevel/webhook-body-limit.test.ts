import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { ghlInboundMessageController, GHL_WEBHOOK_BODY_LIMIT_BYTES } from "../../../../src/domain/messaging/webhook-controller";
import {
  createGHLProviderOutboundController,
  GHL_PROVIDER_OUTBOUND_BODY_LIMIT_BYTES,
} from "../../../../src/integrations/messaging/gohighlevel/provider-outbound";

type TestApp = Hono<{ Bindings: AppBindings; Variables: AppVariables }>;

function requestWithDeclaredOversize(limit: number, path: string): Request {
  return new Request(`https://worker.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(limit + 1),
    },
    body: new Uint8Array(limit + 1).fill(0x61),
  });
}

function requestWithChunkedOversize(limit: number, path: string): Request {
  let total = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const remaining = limit + 1 - total;
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(64 * 1024, remaining);
      controller.enqueue(new Uint8Array(size).fill(0x61));
      total += size;
    },
  });
  return new Request(`https://worker.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function inboundApp(): TestApp {
  const app: TestApp = new Hono();
  app.post("/webhooks/gohighlevel", ghlInboundMessageController);
  return app;
}

function outboundApp(verifySignature: (body: string | Uint8Array, signature: string | undefined) => Promise<boolean>): TestApp {
  const app: TestApp = new Hono();
  app.post("/providers/gohighlevel/outbound", createGHLProviderOutboundController({ verifySignature }));
  return app;
}

test("GHL inbound webhook returns 413 for declared and streamed oversized bodies", async () => {
  const app = inboundApp();
  const env = {} as AppBindings;

  const declared = await app.request(requestWithDeclaredOversize(GHL_WEBHOOK_BODY_LIMIT_BYTES, "/webhooks/gohighlevel"), {}, env);
  assert.equal(declared.status, 413);

  const streamed = await app.request(requestWithChunkedOversize(GHL_WEBHOOK_BODY_LIMIT_BYTES, "/webhooks/gohighlevel"), {}, env);
  assert.equal(streamed.status, 413);
});

test("GHL provider-outbound webhook bounds streamed bodies and verifies the original raw bytes", async () => {
  let verificationCalls = 0;
  let verifiedBytes: Uint8Array | null = null;
  const app = outboundApp(async (body) => {
    verificationCalls++;
    if (body instanceof Uint8Array) verifiedBytes = body;
    return true;
  });
  const env = {
    GHL_CUSTOM_PROVIDER_ENABLED: "true",
    GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: "",
  } as AppBindings;

  const declaredOversized = await app.request(
    requestWithDeclaredOversize(GHL_PROVIDER_OUTBOUND_BODY_LIMIT_BYTES, "/providers/gohighlevel/outbound"),
    {},
    env,
  );
  assert.equal(declaredOversized.status, 413);

  const oversized = await app.request(
    requestWithChunkedOversize(GHL_PROVIDER_OUTBOUND_BODY_LIMIT_BYTES, "/providers/gohighlevel/outbound"),
    {},
    env,
  );
  assert.equal(oversized.status, 413);
  assert.equal(verificationCalls, 0);

  const rawBody = new TextEncoder().encode('{ "locationId":"synthetic-location", "contactId":"synthetic-contact", "messageId":"synthetic-message", "type":"SMS", "message":"hello" }');
  const response = await app.request("/providers/gohighlevel/outbound", {
    method: "POST",
    headers: { "content-type": "application/json", "X-GHL-Signature": "synthetic-signature" },
    body: rawBody,
  }, env);
  assert.equal(verificationCalls, 1);
  assert.deepEqual(verifiedBytes, rawBody);
  assert.equal(response.status, 404);
});

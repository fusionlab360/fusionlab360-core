import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import type { RequestContext } from "../../../../src/context";
import type { AuthenticatedPrincipal } from "../../../../src/core/security/principal";
import { createMetaWhatsAppRoutes } from "../../../../src/integrations/messaging/meta-whatsapp/routes";
import {
  META_DIAGNOSTIC_GRAPH_VERSION,
  META_DIAGNOSTIC_PHONE_NUMBER_ID,
  probeMetaPhoneResource,
} from "../../../../src/integrations/messaging/meta-whatsapp/read-only-diagnostic";

function response(status: number): Response {
  return new Response("{\"sensitive\":true}", { status });
}

function routeApp(permissions: string[], tenantId = "gmmetro") {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("context", { client: { id: "client", tenantId, permissions }, tenant: { id: tenantId, name: tenantId, status: "active" } } as unknown as RequestContext);
    c.set("principal", { type: "client", clientId: "client", tenantId, permissions } satisfies AuthenticatedPrincipal);
    await next();
  });
  app.route("/integrations/meta-whatsapp", createMetaWhatsAppRoutes());
  return app;
}

test("diagnostic is unavailable by default", async () => {
  const response = await routeApp(["integrations:test"]).request("/integrations/meta-whatsapp/diagnostics/verify-phone", { method: "GET" }, { META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED: "false" } as AppBindings);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, errorCode: "diagnostic_disabled" });
});

test("diagnostic requires integrations:test", async () => {
  const response = await routeApp(["integrations:read"]).request("/integrations/meta-whatsapp/diagnostics/verify-phone", { method: "GET" }, { META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED: "true" } as AppBindings);
  assert.equal(response.status, 403);
});

test("diagnostic rejects a non-approved tenant before credential access", async () => {
  const response = await routeApp(["integrations:test"], "other-tenant").request("/integrations/meta-whatsapp/diagnostics/verify-phone", { method: "GET" }, { META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED: "true" } as AppBindings);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, errorCode: "diagnostic_tenant_rejected" });
});

test("builds the fixed GET and sanitizes an HTTP success", async () => {
  let request: Request | undefined;
  const result = await probeMetaPhoneResource({
    accessToken: "secret-token",
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return response(200);
    },
    now: (() => { let value = 1000; return () => (value += 10); })(),
  });
  assert.equal(result.httpResponseReceived, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.safeExceptionClassification, null);
  assert.equal(request?.method, "GET");
  assert.equal(request?.url, `https://graph.facebook.com/${META_DIAGNOSTIC_GRAPH_VERSION}/${META_DIAGNOSTIC_PHONE_NUMBER_ID}?fields=id`);
  assert.equal(request?.headers.get("authorization"), "Bearer secret-token");
  assert.equal(request?.headers.get("content-type"), null);
});

test("sanitizes an upstream HTTP error without reading its body", async () => {
  const result = await probeMetaPhoneResource({ accessToken: "secret-token", fetchImpl: async () => response(400) });
  assert.deepEqual({ httpResponseReceived: result.httpResponseReceived, httpStatus: result.httpStatus, safeExceptionClassification: result.safeExceptionClassification }, {
    httpResponseReceived: true, httpStatus: 400, safeExceptionClassification: null,
  });
});

test("classifies fetch TypeError without exposing the exception", async () => {
  const result = await probeMetaPhoneResource({ accessToken: "secret-token", fetchImpl: async () => { throw new TypeError("token=secret"); } });
  assert.equal(result.httpResponseReceived, false);
  assert.equal(result.safeExceptionClassification, "fetch_type_error");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("classifies aborts and never sends a POST", async () => {
  let method = "";
  const result = await probeMetaPhoneResource({
    accessToken: "secret-token",
    timeoutMs: 1,
    fetchImpl: async (_input, init) => {
      method = init?.method ?? "";
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });
  assert.equal(method, "GET");
  assert.equal(result.safeExceptionClassification, "aborted");
});

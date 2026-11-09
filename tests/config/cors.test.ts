import test from "node:test";
import assert from "node:assert/strict";
import { AppBindings, createApp, corsOriginFor } from "../../src/config/app";
import { authMiddleware } from "../../src/middleware/auth";

const browserOrigin = "https://console.example.test";

function environment(corsAllowedOrigins?: string): AppBindings {
  return {
    APP_ENVIRONMENT: "test",
    JWT_SECRET: "synthetic-jwt-secret-for-cors-tests",
    JWT_ISSUER: "cors-test-issuer",
    JWT_AUDIENCE: "cors-test-audience",
    ...(corsAllowedOrigins === undefined ? {} : { CORS_ALLOWED_ORIGINS: corsAllowedOrigins }),
  } as AppBindings;
}

test("CORS returns an exact approved HTTPS origin and rejects absent, wildcard, or malformed origins", () => {
  assert.equal(corsOriginFor(browserOrigin, browserOrigin, "/auth/me"), browserOrigin);
  assert.equal(corsOriginFor("https://evil.example", browserOrigin, "/auth/me"), "");
  assert.equal(corsOriginFor(browserOrigin, undefined, "/auth/me"), "");
  assert.equal(corsOriginFor("https://evil.example", "*", "/auth/me"), "");
  assert.equal(corsOriginFor("null", browserOrigin, "/auth/me"), "");
  assert.equal(corsOriginFor("https://console.example.test/", browserOrigin, "/auth/me"), "");
});

test("OPTIONS preflight allows only a configured browser origin", async () => {
  const app = createApp();
  app.get("/auth/me", authMiddleware, (c) => c.json({ success: true }));
  const request = (origin: string) => app.request("/auth/me", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  }, environment(browserOrigin));

  const allowed = await request(browserOrigin);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), browserOrigin);
  assert.match(allowed.headers.get("Access-Control-Allow-Methods") ?? "", /GET/);

  const denied = await request("https://evil.example");
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("approved CORS does not bypass authentication and webhook routes stay server-to-server", async () => {
  const app = createApp();
  app.get("/auth/me", authMiddleware, (c) => c.json({ success: true }));
  app.all("/webhooks/gohighlevel", (c) => c.text("webhook"));
  const browserResponse = await app.request("/auth/me", {
    method: "GET",
    headers: { Origin: browserOrigin },
  }, environment(browserOrigin));
  assert.equal(browserResponse.status, 401);
  assert.equal(browserResponse.headers.get("Access-Control-Allow-Origin"), browserOrigin);

  const webhookResponse = await app.request("/webhooks/gohighlevel", {
    method: "OPTIONS",
    headers: {
      Origin: browserOrigin,
      "Access-Control-Request-Method": "POST",
    },
  }, environment(browserOrigin));
  assert.equal(webhookResponse.headers.get("Access-Control-Allow-Origin"), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { AppBindings } from "../config/app";
import {
  createApplication,
  shouldEnableNonProductionRoutes,
} from "./routes";

function bindings(environment: string): AppBindings {
  return {
    APP_ENVIRONMENT: environment,
    DB: {} as D1Database,
    JWT_SECRET: "route-test-secret",
    JWT_ISSUER: "route-test-issuer",
    JWT_AUDIENCE: "route-test-audience",
  } as AppBindings;
}

function hasRoute(
  app: ReturnType<typeof createApplication>,
  method: string,
  path: string,
): boolean {
  return app.routes.some((route) =>
    route.method === method && route.path === path,
  );
}

test("production application omits non-production routes and keeps business APIs", async () => {
  const app = createApplication("production");
  const env = bindings("production");

  const testPaths: Array<[string, string]> = [
    ["POST", "/booking/intent-test"],
    ["POST", "/booking/ai-test"],
    ["POST", "/ai-test/chat"],
    ["POST", "/ai-test/session"],
    ["GET", "/messaging-test/conversations/:conversationId/messages"],
    ["POST", "/messaging-test/conversations/:conversationId/reply"],
    ["POST", "/knowledge/evaluate"],
    ["POST", "/integrations/gohighlevel/company/refresh-test"],
  ];

  for (const [method, path] of testPaths) {
    assert.equal(
      hasRoute(app, method, path),
      false,
      `${method} ${path} must not be registered`,
    );
  }

  assert.equal(
    (await app.request("/booking/offerings", {}, env)).status,
    401,
    "legitimate booking API remains registered behind authentication",
  );
  assert.equal(
    (await app.request("/ai/profile", {}, env)).status,
    401,
    "legitimate AI API remains registered behind authentication",
  );
  assert.equal(
    (await app.request("/integrations/gohighlevel/events/preview", { method: "POST" }, env)).status,
    401,
    "legitimate integration discovery remains registered behind authentication",
  );
  assert.equal(hasRoute(app, "POST", "/reservations/sync"), true);
});

test("development and staging applications retain test routes with authorization", async () => {
  for (const environment of ["development", "staging"]) {
    const app = createApplication(environment);
    const env = bindings(environment);

    const protectedPaths: Array<[string, string]> = [
      ["POST", "/booking/intent-test"],
      ["POST", "/booking/ai-test"],
      ["POST", "/ai-test/chat"],
      ["POST", "/ai-test/session"],
      ["GET", "/messaging-test/conversations/:conversationId/messages"],
      ["POST", "/messaging-test/conversations/:conversationId/reply"],
      ["POST", "/knowledge/evaluate"],
      ["POST", "/integrations/gohighlevel/company/refresh-test"],
    ];

    for (const [method, path] of protectedPaths) {
      assert.equal(
        hasRoute(app, method, path),
        true,
        `${environment} ${method} ${path} is registered`,
      );
      const response = await app.request(path, { method }, env);
      assert.equal(
        response.status,
        401,
        `${environment} ${method} ${path} remains behind API authentication`,
      );
    }
  }
});

test("missing or unknown environment labels fail closed to production routes", () => {
  assert.equal(shouldEnableNonProductionRoutes(undefined), false);
  assert.equal(shouldEnableNonProductionRoutes("production"), false);
  assert.equal(shouldEnableNonProductionRoutes("preview"), false);
  assert.equal(shouldEnableNonProductionRoutes("development"), true);
  assert.equal(shouldEnableNonProductionRoutes("staging"), true);
});

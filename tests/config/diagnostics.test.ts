import test from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppBindings } from "../../src/config/app";
import { ApiError } from "../../src/core/errors/ApiError";

function environment(mode?: string): AppBindings {
  return {
    APP_ENVIRONMENT: "test",
    JWT_SECRET: "synthetic-diagnostics-secret",
    JWT_ISSUER: "diagnostics-tests",
    JWT_AUDIENCE: "diagnostics-tests",
    CORE_DIAGNOSTICS_LEVEL: mode,
  } as AppBindings;
}

test("HTTP diagnostics correlate sanitized errors and record route templates", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const app = createApp();
  app.get("/diagnostic/:id", () => { throw new ApiError(500, "synthetic private payload"); });
  const env = environment("DEBUG");
  const response = await app.request("/diagnostic/private-id?token=private-token", {}, env);
  assert.equal(response.status, 500);
  const body = await response.json() as { correlationId: string; message: string };
  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(records.map((entry) => entry.event), ["http.start", "http.complete"]);
  assert.equal(records[0].correlationId, body.correlationId);
  assert.equal(records[1].correlationId, body.correlationId);
  assert.equal(records[1].route, "/diagnostic/:id");
  assert.equal(records[1].code, "INTERNAL_ERROR");
  assert.equal(body.message, "Internal Server Error");
  assert.doesNotMatch(JSON.stringify(records), /private-id|private-token|private payload/);
});

test("default diagnostics suppress successful traffic and OFF suppresses failures", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const app = createApp();
  app.get("/diagnostic", (c) => c.text("ok"));
  assert.equal((await app.request("/diagnostic", {}, environment())).status, 200);
  assert.equal((await app.request("/missing", {}, environment("OFF"))).status, 404);
  assert.equal(log.mock.callCount(), 0);
  assert.equal((await app.request("/missing", {}, environment())).status, 404);
  assert.equal(log.mock.callCount(), 1);
});

test("a failing log sink leaves the response intact", async (t) => {
  t.mock.method(console, "log", () => { throw new Error("sink disconnected"); });
  const app = createApp();
  app.get("/diagnostic", (c) => c.text("ok"));
  const response = await app.request("/diagnostic", {}, environment("DEBUG"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("permission denial preserves responses and records only the stage", async (t) => {
  const { requirePermission } = await import("../../src/middleware/authorization");
  const { createRequestContext } = await import("../../src/context/factory");
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const app = createApp();
  app.use("/permission-test", async (c, next) => {
    const diagnostics = c.get("diagnostics");
    const context = createRequestContext(
      { id: "private-client", tenantId: "private-tenant", permissions: [], name: "Fixture", apiKey: "", status: "active" },
      { id: "private-tenant" } as Parameters<typeof createRequestContext>[1],
      {} as Parameters<typeof createRequestContext>[2],
      diagnostics?.correlationId,
    );
    assert.equal(context.requestId, diagnostics?.correlationId);
    c.set("context", context);
    c.set("principal", {
      type: "client", clientId: "private-client",
      tenantId: c.req.query("mismatch") ? "private-other-tenant" : "private-tenant", permissions: [],
    });
    await next();
  });
  app.get("/permission-test", requirePermission("features:write"), (c) => c.text("unexpected"));
  for (const [query, status, message] of [
    ["?mismatch=1", 401, "Unauthorized."],
    ["", 403, "Insufficient permissions."],
  ] as const) {
    const response = await app.request("/permission-test" + query, {}, environment());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { success: false, message });
    const event = JSON.parse(lines.at(-1)!);
    assert.equal(event.stage, "permission");
    assert.equal(event.code, "AUTH_FAILURE");
  }
  assert.doesNotMatch(lines.join("\n"), /private-/);
});

test("invalid diagnostic metadata is omitted", async (t) => {
  const { createDiagnostics } = await import("../../src/core/logger/diagnostics");
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const diagnostics = createDiagnostics("DEBUG", "private-token");
  diagnostics.emit("http.complete", "failed", "INTERNAL_ERROR", {
    method: "private-method",
    route: "/health?token=private-token",
    status: 999,
    durationMs: Infinity,
  });
  const record = JSON.parse(lines[0]!);
  for (const key of ["method", "route", "status", "durationMs"]) assert.equal(key in record, false);
  assert.match(record.correlationId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(lines.join("\n"), /private-/);
});

test("HTTP errors in OFF mode retain one sanitized legacy signal", async (t) => {
  const lines: unknown[][] = [];
  t.mock.method(console, "log", (...args: unknown[]) => lines.push(args));
  const app = createApp();
  app.get("/generic-error", () => { throw new Error("private-exception"); });
  app.get("/api-error", () => { throw new ApiError(403, "private-credential"); });

  const generic = await app.request("/generic-error", {}, environment("OFF"));
  assert.equal(generic.status, 500);
  assert.deepEqual(await generic.json(), { success: false, message: "Internal Server Error" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.[1], "Unhandled application error");
  assert.doesNotMatch(JSON.stringify(lines), /private-/);

  lines.length = 0;
  const denied = await app.request("/api-error", {}, environment("OFF"));
  const correlationId = denied.headers.get("X-Correlation-ID");
  assert.ok(correlationId);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { success: false, message: "Access denied.", code: "API_ERROR", correlationId });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.[1], "API error");
  assert.deepEqual(lines[0]?.[2], { status: 403, code: "API_ERROR", correlationId });
  assert.doesNotMatch(JSON.stringify(lines), /private-/);
});

test("default mode emits one structured completion for an unhandled error", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const app = createApp();
  app.get("/error", () => { throw new Error("private-exception"); });
  const response = await app.request("/error", {}, environment());
  assert.equal(response.status, 500);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]!).event, "http.complete");
  assert.doesNotMatch(lines.join("\n"), /private-/);
});

test("a throwing fallback log sink preserves the OFF error response", async (t) => {
  t.mock.method(console, "log", () => { throw new Error("sink disconnected"); });
  const app = createApp();
  app.get("/error", () => { throw new Error("private-exception"); });
  const response = await app.request("/error", {}, environment("OFF"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, message: "Internal Server Error" });
});

import { Hono } from "hono";
import type { AppBindings } from "../../../config/app";
import { normalizeGHLConversationProviderId } from "./custom-conversation-provider";
import { validateGHLReadonlyContext, type GHLReadonlyContextAllowlist } from "./whatsapp-readonly-context";
import { readWhatsAppReadonlyStatus } from "./whatsapp-readonly-status";
import { whatsappReadonlyPage } from "./whatsapp-readonly-page";

type App = Hono<{ Bindings: AppBindings }>;
type ReadonlyPageConfiguration = GHLReadonlyContextAllowlist & { parentOrigins: string[] };
type ContextVerifierConfiguration = GHLReadonlyContextAllowlist & { allowedOrigin: string };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const VERIFY_CONTEXT_PATH = "/verify-context";
const VERIFY_CONTEXT_BODY_LIMIT = 9000;
const isIdentifier = (value: string | undefined): value is string =>
  typeof value === "string" && IDENTIFIER_PATTERN.test(value) && !value.includes("*");

function safeParentOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const origins = value.split(",").map((item) => item.trim());
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol !== "https:" || url.origin !== origin || url.username !== "" || url.password !== "";
    } catch {
      return true;
    }
  })) return [];
  return [...new Set(origins)];
}

function pageConfiguration(env: AppBindings): ReadonlyPageConfiguration | null {
  let enabled: string | undefined;
  let tenant: string | undefined;
  let location: string | undefined;
  let user: string | undefined;
  let company: string | undefined;
  let app: string | undefined;

  if (env.APP_ENVIRONMENT === "preview") {
    enabled = env.WABA_GHL_READONLY_PREVIEW_ENABLED;
    tenant = env.WABA_GHL_READONLY_PREVIEW_TENANT_ALLOWLIST;
    location = env.WABA_GHL_READONLY_PREVIEW_LOCATION_ALLOWLIST;
    user = env.WABA_GHL_READONLY_PREVIEW_USER_ALLOWLIST;
    company = env.WABA_GHL_READONLY_PREVIEW_COMPANY_ALLOWLIST;
    app = env.WABA_GHL_READONLY_PREVIEW_APP_ID;
  } else if (env.APP_ENVIRONMENT === "production") {
    enabled = env.WABA_GHL_READONLY_ENABLED;
    tenant = env.WABA_GHL_READONLY_TENANT_ALLOWLIST;
    location = env.WABA_GHL_READONLY_LOCATION_ALLOWLIST;
    user = env.WABA_GHL_READONLY_USER_ALLOWLIST;
    company = env.WABA_GHL_READONLY_COMPANY_ALLOWLIST;
    app = env.WABA_GHL_READONLY_APP_ID;
  } else {
    return null;
  }

  const parentOrigins = safeParentOrigins(env.GHL_WHATSAPP_PAGE_PARENT_ORIGINS);
  const sharedSecret = env.GHL_APP_SHARED_SECRET;
  if (
    enabled !== "true" || !sharedSecret ||
    !isIdentifier(tenant) || !isIdentifier(location) || !isIdentifier(user) ||
    !isIdentifier(company) || !isIdentifier(app) || parentOrigins.length === 0
  ) return null;

  return { tenant, location, user, company, app, sharedSecret, parentOrigins };
}

function exactHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.origin !== value ||
      url.username !== "" || url.password !== ""
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function contextVerifierConfiguration(env: AppBindings): ContextVerifierConfiguration | null {
  if (env.APP_ENVIRONMENT !== "production" || env.WABA_GHL_CONTEXT_VERIFY_ENABLED !== "true") return null;
  const { WABA_GHL_READONLY_TENANT_ALLOWLIST: tenant,
    WABA_GHL_READONLY_LOCATION_ALLOWLIST: location,
    WABA_GHL_READONLY_USER_ALLOWLIST: user,
    WABA_GHL_READONLY_COMPANY_ALLOWLIST: company,
    WABA_GHL_READONLY_APP_ID: app,
    GHL_APP_SHARED_SECRET: sharedSecret } = env;
  const allowedOrigin = exactHttpsOrigin(env.WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN);
  if (
    !allowedOrigin || !sharedSecret || !isIdentifier(tenant) || !isIdentifier(location) ||
    !isIdentifier(user) || !isIdentifier(company) || !isIdentifier(app)
  ) return null;
  return { tenant, location, user, company, app, sharedSecret, allowedOrigin };
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > VERIFY_CONTEXT_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function privateResponseHeaders(c: { header(name: string, value: string): void }): void {
  c.header("Cache-Control", "no-store, private");
  c.header("Pragma", "no-cache");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
}

// HighLevel's encrypted context has no documented first-use freshness,
// nonce, or expiry guarantee. It is accepted only for this minimal read-only
// view and never authorizes mutations or message operations.
export function createWhatsAppReadonlyCanary(): App {
  const app: App = new Hono<{ Bindings: AppBindings }>();

  app.get("/", (c) => {
    const configuration = pageConfiguration(c.env);
    const requested = new URL(c.req.url);
    if (!configuration || requested.search) return c.notFound();

    privateResponseHeaders(c);
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${configuration.parentOrigins.join(" ")}; base-uri 'none'; form-action 'none'`,
    );
    return c.html(whatsappReadonlyPage.replace(
      "__GHL_PARENT_ORIGINS__",
      JSON.stringify(configuration.parentOrigins),
    ));
  });

  app.get("/status", async (c) => {
    const configuration = pageConfiguration(c.env);
    const requestUrl = new URL(c.req.url);
    const contentLength = c.req.header("Content-Length");
    if (!configuration) return c.notFound();
    privateResponseHeaders(c);
    if (requestUrl.search || (contentLength !== undefined && contentLength !== "0") || c.req.header("Transfer-Encoding")) {
      return c.json({ success: false, errorCode: "REQUEST_REJECTED" }, 400);
    }

    try {
      const validation = await validateGHLReadonlyContext(c.env.DB, configuration, c.req.header("X-GHL-Encrypted-Context"));
      if (!validation.verified) return c.json({ success: false, errorCode: validation.code }, 403);
      const installation = validation.installation;

      const providerConfigured = normalizeGHLConversationProviderId(installation.providerIdentifier) !== null;
      const status = await readWhatsAppReadonlyStatus(c.env, installation.tenantId, configuration.location, providerConfigured);
      return c.json({ success: true, location: configuration.location, status });
    } catch {
      // Do not distinguish repository errors in a way that leaks tenant or
      // installation state. The page is diagnostic-free and strictly read-only.
      return c.json({ success: false, errorCode: "STATUS_UNAVAILABLE" }, 503);
    }
  });

  // CORS is only a browser boundary; the encrypted context and local ownership
  // checks authenticate the request. HighLevel does not document first-use
  // freshness for this context, so this route returns no data or mutation grant.
  app.use(VERIFY_CONTEXT_PATH, async (c, next) => {
    privateResponseHeaders(c);
    const configuration = contextVerifierConfiguration(c.env);
    if (!configuration) return c.json({ verified: false, code: "VERIFIER_UNAVAILABLE" }, 404);

    const origin = c.req.header("Origin");
    if (origin !== configuration.allowedOrigin) {
      return c.json({ verified: false, code: "ORIGIN_NOT_ALLOWED" }, 403);
    }
    if (new URL(c.req.url).search) {
      return c.json({ verified: false, code: "REQUEST_REJECTED" }, 400);
    }

    if (c.req.method === "OPTIONS") {
      const requestedMethod = c.req.header("Access-Control-Request-Method");
      const requestedHeaders = (c.req.header("Access-Control-Request-Headers") ?? "")
        .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
      if (requestedMethod !== "POST" || requestedHeaders.length !== 1 || requestedHeaders[0] !== "content-type") {
        return c.json({ verified: false, code: "REQUEST_REJECTED" }, 403);
      }
      c.header("Access-Control-Allow-Origin", configuration.allowedOrigin);
      c.header("Access-Control-Allow-Methods", "POST");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "0");
      c.header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
      return c.body(null, 204);
    }

    if (c.req.method !== "POST") return c.json({ verified: false, code: "REQUEST_REJECTED" }, 405);
    c.header("Access-Control-Allow-Origin", configuration.allowedOrigin);
    c.header("Vary", "Origin");
    await next();
  });

  app.options(VERIFY_CONTEXT_PATH, (c) => c.body(null, 204));

  app.post(VERIFY_CONTEXT_PATH, async (c) => {
    const configuration = contextVerifierConfiguration(c.env);
    if (!configuration) return c.json({ verified: false, code: "VERIFIER_UNAVAILABLE" }, 404);
    const contentLength = c.req.header("Content-Length");
    const contentType = c.req.header("Content-Type")?.trim().toLowerCase();
    if (
      new URL(c.req.url).search || c.req.header("X-GHL-Encrypted-Context") !== undefined ||
      c.req.header("Transfer-Encoding") !== undefined ||
      (c.req.header("Content-Encoding") !== undefined && c.req.header("Content-Encoding") !== "identity") ||
      (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > VERIFY_CONTEXT_BODY_LIMIT)) ||
      (contentType !== "application/json" && contentType !== "application/json; charset=utf-8")
    ) return c.json({ verified: false, code: "REQUEST_REJECTED" }, 400);

    let rawBody: string | null;
    try {
      rawBody = await readBoundedBody(c.req.raw);
    } catch {
      return c.json({ verified: false, code: "CONTEXT_MALFORMED" }, 400);
    }
    if (rawBody === null) return c.json({ verified: false, code: "CONTEXT_MALFORMED" }, 400);
    if (rawBody.trim() === "") return c.json({ verified: false, code: "CONTEXT_NOT_RECEIVED" }, 403);
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ verified: false, code: "CONTEXT_MALFORMED" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ verified: false, code: "CONTEXT_MALFORMED" }, 400);
    }
    const payload = body as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(payload, "encryptedContext")) {
      return c.json({ verified: false, code: "CONTEXT_NOT_RECEIVED" }, 403);
    }
    if (Object.keys(payload).length !== 1) return c.json({ verified: false, code: "CONTEXT_MALFORMED" }, 400);

    try {
      const validation = await validateGHLReadonlyContext(c.env.DB, configuration, payload.encryptedContext);
      if (!validation.verified) return c.json({ verified: false, code: validation.code }, 403);
      return c.json({ verified: true, code: "CONTEXT_VERIFIED" });
    } catch {
      return c.json({ verified: false, code: "VERIFICATION_UNAVAILABLE" }, 503);
    }
  });

  return app;
}

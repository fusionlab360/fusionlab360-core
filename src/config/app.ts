import { Hono } from "hono";
import { cors } from "hono/cors";

import { handleError } from "../bootstrap/error";
import type { RequestContext } from "../context";
import type { AuthenticatedPrincipal } from "../core/security/principal";

import {
  bootstrapSecurity,
} from "../bootstrap/security";
import type {
  GHLInboundQueueEnvelope,
} from "../domain/messaging/inbound-queue-contract";


export type AppBindings = {

  /** Runtime environment label supplied by Wrangler; unknown values fail closed. */
  APP_ENVIRONMENT?: string;

  /** Cloudflare-provided identity for the deployed Worker version. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;

  AI:
    Ai;

  DB:
    D1Database;

  VECTORIZE:
  Vectorize;

  VECTORIZE_V2:
    Vectorize;

  JWT_SECRET:
    string;

  JWT_ISSUER:
    string;

  JWT_AUDIENCE:
    string;

  GHL_OAUTH_CLIENT_ID:
    string;

  GHL_OAUTH_CLIENT_SECRET:
    string;

  /** Explicit per-environment OAuth callback; absent/blank fails closed. */
  GHL_OAUTH_REDIRECT_URI?:
    string;

  /** Explicit provider-approved scopes used to build the OAuth install URL. */
  GHL_OAUTH_SCOPES?:
    string;

  /** Shared Secret used only to verify HighLevel Custom Page user context. */
  GHL_APP_SHARED_SECRET?: string;
  GHL_WHATSAPP_PAGE_PARENT_ORIGINS?: string;
  /** Production read-only page gate and exact single-value allowlists. */
  WABA_GHL_READONLY_ENABLED?: string;
  WABA_GHL_READONLY_TENANT_ALLOWLIST?: string;
  WABA_GHL_READONLY_LOCATION_ALLOWLIST?: string;
  WABA_GHL_READONLY_USER_ALLOWLIST?: string;
  WABA_GHL_READONLY_COMPANY_ALLOWLIST?: string;
  WABA_GHL_READONLY_APP_ID?: string;
  /** Temporary identity-only GHL context verifier; production default is off. */
  WABA_GHL_CONTEXT_VERIFY_ENABLED?: string;
  /** One exact HTTPS origin permitted to call the identity-only verifier. */
  WABA_GHL_CONTEXT_VERIFY_ALLOWED_ORIGIN?: string;
  /** Isolated Preview-only gate and allowlists. */
  WABA_GHL_READONLY_PREVIEW_ENABLED?: string;
  WABA_GHL_READONLY_PREVIEW_TENANT_ALLOWLIST?: string;
  WABA_GHL_READONLY_PREVIEW_LOCATION_ALLOWLIST?: string;
  WABA_GHL_READONLY_PREVIEW_USER_ALLOWLIST?: string;
  WABA_GHL_READONLY_PREVIEW_COMPANY_ALLOWLIST?: string;
  WABA_GHL_READONLY_PREVIEW_APP_ID?: string;

  GEMINI_API_KEY:
    string;

      /**
   * Controls whether the AI appointment-booking engine
   * is available to the normal inbound AI conversation flow.
   *
   * Safe default: disabled.
   */
   AI_BOOKING_ENABLED?: string;

  /**
   * Comma-separated tenant IDs permitted for AI Pipeline V2.
   * Missing or empty means no tenants are eligible.
   *
   * Eligibility alone does not activate the new pipeline.
   */
  AI_PIPELINE_V2_TENANT_ALLOWLIST?: string;

  /** Queue mode is opt-in until an environment binding is reviewed. */
  GHL_INBOUND_QUEUE_ENABLED?: string;

  /** New reservation/Meta Queue envelope publishing is opt-in. */
  NEW_QUEUE_ENVELOPES_ENABLED?: string;

  /** Opt-in only: forwards processed Meta inbound text to GHL Custom Inbox. */
  META_WHATSAPP_GHL_INBOUND_ENABLED?: string;
  /** Exactly one tenant may use the Meta-to-GHL pilot. */
  META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST?: string;

  /** Manual human-agent replies remain disabled unless explicitly enabled. */
  MANUAL_REPLY_ENABLED?: string;

  /** Opt-in only: accepts signed GHL Custom Conversation Provider callbacks. */
  GHL_CUSTOM_PROVIDER_ENABLED?: string;

  /** Exactly one GHL location ID authorized for the Custom Provider pilot. */
  GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST?: string;

  /** Opt-in only: sends the single GHL provider pilot's agent replies through Meta. */
  GHL_META_WHATSAPP_OUTBOUND_ENABLED?: string;
  WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED?: string;
  /** Exact operator-verified installation references permitted for activation. */
  WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST?: string;
  /** Exact, operator-approved evidence references eligible for legacy review. */
  WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST?: string;

  /** Temporary, fail-closed operator diagnostic for a single contact pilot. */
  GHL_OPERATOR_CONTACT_DIAGNOSTIC_ENABLED?: string;
  GHL_OPERATOR_CONTACT_DIAGNOSTIC_TENANT_ALLOWLIST?: string;
  GHL_OPERATOR_CONTACT_DIAGNOSTIC_LOCATION_ALLOWLIST?: string;
  GHL_OPERATOR_CONTACT_DIAGNOSTIC_PHONE_E164?: string;

  /** Temporary, fail-closed read-only GHL provider inspection. */
  GHL_OPERATOR_PROVIDER_INSPECTION_ENABLED?: string;

  /** Temporary, fail-closed Meta phone-resource diagnostic. */
  META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED?: string;
  WABA_OPS_ALERTS_ENABLED?: string;
  WABA_OPS_BACKLOG_THRESHOLD?: string;
  WABA_OPS_FAILURE_THRESHOLD?: string;
  WABA_OPS_DEAD_LETTER_THRESHOLD?: string;
  WABA_OPS_CREDENTIAL_EXPIRY_THRESHOLD?: string;
  WABA_OPS_CORRELATION_FAILURE_THRESHOLD?: string;

  GHL_INBOUND_QUEUE?: Queue<GHLInboundQueueEnvelope>;

  META_WHATSAPP_APP_SECRET?: string;
  META_WHATSAPP_VERIFY_TOKEN?: string;
  /** Meta app identifier used only by the server-side onboarding exchange. */
  META_WHATSAPP_APP_ID?: string;
  /** Explicit Graph API version, for example v22.0. */
  META_WHATSAPP_GRAPH_API_VERSION?: string;
  /** Secret JSON keyring: { "version": "base64-encoded-32-byte-key" }. */
  META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS?: string;
  /** Active key version used for new Meta WhatsApp credentials. */
  META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION?: string;

  /** Secret keyring for encrypted provider credentials stored by Core. */
  CORE_CREDENTIAL_ENCRYPTION_KEYS?: string;
  /** Active key version for new encrypted provider credentials. */
  CORE_CREDENTIAL_ACTIVE_KEY_VERSION?: string;
  /** Temporary compatibility switch for pre-encryption GHL credentials. */
  CORE_CREDENTIAL_LEGACY_READS_ENABLED?: string;

  /** Comma-separated exact browser origins; absent configuration denies cross-origin browser access. */
  CORS_ALLOWED_ORIGINS?: string;

  /** Explicit, single-asset guard for temporary developer test tokens. */
  META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED?: string;
  META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST?: string;

};


export type AppVariables = {

  context:
    RequestContext;

  principal?:
    AuthenticatedPrincipal;

};

export function corsOriginFor(
  origin: string | undefined,
  configuredOrigins: string | undefined,
  path = "/",
): string {
  if (!origin || origin === "null") return "";
  if (path.startsWith("/webhooks/") || path === "/health" || path === "/") return "";

  const allowedOrigins = (configuredOrigins ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || value === "*") return false;
      try {
        const parsed = new URL(value);
        return parsed.origin === value && (
          parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
        );
      } catch {
        return false;
      }
    });

  return allowedOrigins.includes(origin) ? origin : "";
}

export function createApp() {
  const app = new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


/**
 * Initialize security from Worker environment.
 *
 * JWT configuration is loaded from Cloudflare Worker
 * secrets/bindings rather than hardcoded application values.
 *
 * bootstrapSecurity() is idempotent and initializes the
 * provider once per Worker isolate.
 */
app.use(
  "*",
  async (
    c,
    next,
  ) => {
    const previewCanaryPath = c.env.APP_ENVIRONMENT === "preview" && (
      c.req.path === "/marketplace/gohighlevel/whatsapp-preview" ||
      c.req.path === "/marketplace/gohighlevel/whatsapp-preview/" ||
      c.req.path === "/marketplace/gohighlevel/whatsapp-preview/status"
    );
    if (!previewCanaryPath) bootstrapSecurity({

      JWT_SECRET:
        c.env.JWT_SECRET,

      JWT_ISSUER:
        c.env.JWT_ISSUER,

      JWT_AUDIENCE:
        c.env.JWT_AUDIENCE,

    });


    await next();

  },
);


/**
 * Request logger
 */
app.use(
  "*",
  async (
    c,
    next,
  ) => {

    // Paths may contain tenant, contact, conversation, or other customer IDs.
    // Keep request logs useful without copying caller-controlled path segments.
    console.log("HTTP request received.", {
      method: c.req.method,
    });

    await next();

  },
);


/**
 * CORS
 */
const defaultCors = cors({
  origin: (origin: string, context: { env: AppBindings; req: { path: string } }) =>
    corsOriginFor(origin, context.env.CORS_ALLOWED_ORIGINS, context.req.path),
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "Accept", "Origin"],
});

app.use("*", async (c, next) => {
  const verifierPath = "/marketplace/gohighlevel/whatsapp-preview/verify-context";
  if (c.req.path === verifierPath || c.req.path.startsWith(`${verifierPath}/`)) {
    // The verifier implements its own exact-origin, POST/content-type-only CORS.
    // Do not let Core's general API CORS add wildcard access or broad preflight.
    await next();
    return;
  }
  return defaultCors(c, next);
});


/**
 * Global error handler
 */
app.onError(
  (err) =>
    handleError(
      err,
    ),
);

/**
 * Unknown route handler
 */
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: "Not Found",
    },
    404,
  );
});

  return app;
}

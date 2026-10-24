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

  /** Manual human-agent replies remain disabled unless explicitly enabled. */
  MANUAL_REPLY_ENABLED?: string;

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

};


export type AppVariables = {

  context:
    RequestContext;

  principal?:
    AuthenticatedPrincipal;

};


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

    bootstrapSecurity({

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

    console.log(
      `${c.req.method} ${c.req.path}`,
    );

    await next();

  },
);


/**
 * CORS
 */
app.use(
  "*",
  cors({

    origin:
      "*",

    allowMethods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Origin",
    ],

  }),
);


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

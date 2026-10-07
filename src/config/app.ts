import { Hono } from "hono";
import { cors } from "hono/cors";

import { handleError } from "../bootstrap/error";
import type { RequestContext } from "../context";

import {
  bootstrapSecurity,
} from "../bootstrap/security";


export type AppBindings = {

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

  GEMINI_API_KEY:
    string;

      /**
   * Controls whether the AI appointment-booking engine
   * is available to the normal inbound AI conversation flow.
   *
   * Safe default: disabled.
   */
  AI_BOOKING_ENABLED?: string;

};


export type AppVariables = {

  context:
    RequestContext;

};


export const app =
  new Hono<{
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
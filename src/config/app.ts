import { Hono } from "hono";
import { cors } from "hono/cors";

import { handleError } from "../bootstrap/error";
import type { RequestContext } from "../context";

export type AppBindings = {
  DB: D1Database;

  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
};

export type AppVariables = {
  context: RequestContext;
};

export const app = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// Request logger
app.use("*", async (c, next) => {
  console.log(`${c.req.method} ${c.req.path}`);
  await next();
});

// CORS
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Origin",
    ],
  })
);

app.onError((err) => handleError(err));
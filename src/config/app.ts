import { Hono } from "hono";
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

app.onError((err) => handleError(err));
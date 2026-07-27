import type { Context } from "hono";
import type { AppBindings } from "../../config/app";

export function getDatabase(
  context: Context<{ Bindings: AppBindings }>,
): D1Database {
  return context.env.DB;
}
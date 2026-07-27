import type { Context } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { processReservation } from "./service";

export async function processReservationController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  const body = await c.req.json();

  const context = c.get("context");

  const result = await processReservation(
    context,
    body
  );

  return c.json(result);
}
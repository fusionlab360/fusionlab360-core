import type { Context } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { logger } from "../../core/logger";
import { processReservation } from "./service";
import { ApiError } from "../../core/errors/ApiError";
import { validateReservation } from "./validator";

export function createProcessReservationController(
  processor: typeof processReservation = processReservation,
) {
  return async function processReservationController(
    c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  ) {
    try {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new ApiError(400, "Request body must contain valid JSON.");
      }

      const reservation = validateReservation(body);
      const context = c.get("context");
      const result = await processor(c.env.DB, context, reservation);

      if (!result.success) {
        throw new ApiError(502, "Reservation processing did not complete.");
      }

      logger.info("Reservation request processed", {
        tenantId: context.tenant.id,
        provider: reservation.provider ?? "unknown",
      });
      return c.json(result);
    } catch (error: unknown) {
      logger.error("Reservation controller failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  };
}

export const processReservationController =
  createProcessReservationController();

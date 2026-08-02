import type { Context } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { logger } from "../../core/logger";
import { processReservation } from "./service";

export async function processReservationController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  try {
    logger.info("Reservation request received");

    const body = await c.req.json();

console.log("================================");
console.log("CONTROLLER RECEIVED BODY");
console.log(JSON.stringify(body, null, 2));
console.log("================================");

    logger.debug("Reservation payload received", body);

    const context = c.get("context");

    logger.debug("Reservation context loaded", {
      tenantId: context.tenant.id,
      crmProvider: context.tenant.integrations.crm.provider,
    });

    const result = await processReservation(
      context,
      body
    );

    logger.info("Reservation processed successfully", result);

    return c.json(result);

  } catch (error) {

    logger.error("Reservation controller failed", {
      error,
    });

    throw error;
  }
}
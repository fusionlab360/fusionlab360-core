import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { logger } from "../../core/logger";
import { discoverAndSaveConfiguration } from "./service";

export async function discoverIntegrationController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  try {

    logger.info("Integration discovery started");

    const context = c.get("context");

    logger.debug("Integration context loaded", {
      tenantId: context.tenant.id,
      integrationId: context.tenant.integrations.crm.id,
    });

    const configuration =
      await discoverAndSaveConfiguration(
        c.env.DB,
        context,
      );

    logger.info("Integration discovery completed", {
      workflow: configuration.workflow.key,
      attributeMappings:
        configuration.attributeMappings.length,
    });

    return c.json(configuration);

  } catch (error) {

    logger.error("Integration discovery failed", {
      error,
    });

    return c.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error",
        stack:
          error instanceof Error
            ? error.stack
            : undefined,
      },
      500,
    );
  }
}
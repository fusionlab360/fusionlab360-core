import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import { discoverIntegrationConfiguration } from "./discovery";

export async function discoverIntegrationController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>
) {
  try {
    const context = c.get("context");

    const configuration =
      await discoverIntegrationConfiguration(context);

    return c.json(configuration);
  } catch (error) {
    console.error(error);

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
      500
    );
  }
}
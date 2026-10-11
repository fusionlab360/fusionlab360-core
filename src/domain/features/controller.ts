import type { Context } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  isTenantFeatureKey,
  setTenantFeatureEnabled,
  TENANT_FEATURES,
} from "./tenant-feature-service";

type FeatureContext = Context<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>;

export async function getTenantFeatures(c: FeatureContext) {
  const context = c.get("context");

  try {
    const result = await c.env.DB
      .prepare(
        `SELECT feature_key, enabled
         FROM tenant_feature_settings
         WHERE tenant_id = ?`,
      )
      .bind(context.tenant.id)
      .all<{
        feature_key: string;
        enabled: number;
      }>();

    const storedSettings = new Map(
      (result.results ?? []).map((row) => [
        row.feature_key,
        row.enabled === 1,
      ]),
    );

    const features = Object.entries(TENANT_FEATURES).map(
      ([key, definition]) => ({
        key,
        ...definition,
        enabled: storedSettings.has(key)
          ? storedSettings.get(key)!
          : definition.defaultEnabled,
      }),
    );

    return c.json({
      success: true,
      features,
    });
  } catch (error: unknown) {
    console.error("Failed to load tenant feature settings.", {
      tenantId: context.tenant.id,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    return c.json(
      {
        success: false,
        error: "Failed to load feature settings",
      },
      500,
    );
  }
}

export async function updateTenantFeature(c: FeatureContext) {
    const context = c.get("context");
    const featureKey = c.req.param("featureKey");

    if (!featureKey || !isTenantFeatureKey(featureKey)) {
    return c.json(
        {
        success: false,
        error: "Unknown feature key",
        },
        404,
    );
    }

  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: "Invalid JSON body",
      },
      400,
    );
  }

  if (
    body === null ||
    typeof body !== "object" ||
    !("enabled" in body) ||
    typeof body.enabled !== "boolean"
  ) {
    return c.json(
      {
        success: false,
        error: "enabled must be a boolean",
      },
      400,
    );
  }

  try {
    await setTenantFeatureEnabled(
      c.env.DB,
      context.tenant.id,
      featureKey,
      body.enabled,
    );

    return c.json({
      success: true,
      feature: {
        key: featureKey,
        label: TENANT_FEATURES[featureKey].label,
        enabled: body.enabled,
      },
    });
  } catch (error: unknown) {
    console.error("Failed to update tenant feature setting.", {
      tenantId: context.tenant.id,
      featureKey,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    return c.json(
      {
        success: false,
        error: "Failed to update feature setting",
      },
      500,
    );
  }
}
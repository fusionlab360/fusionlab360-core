
import assert from "node:assert/strict";
import test from "node:test";

import {
  TENANT_FEATURES,
  isTenantFeatureEnabled,
  isTenantFeatureKey,
  setTenantFeatureEnabled,
} from "./tenant-feature-service";

function settingKey(
  tenantId: string,
  featureKey: string,
): string {
  return `${tenantId}:${featureKey}`;
}

function createFakeDb() {
  const settings = new Map<string, number>();

  const fakeDb = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            first: async <T>() => {
              if (
                !sql.trim().toUpperCase().startsWith(
                  "SELECT ENABLED",
                )
              ) {
                throw new Error(
                  `Unexpected query in first(): ${sql}`,
                );
              }

              const [tenantId, featureKey] = values;

              if (
                typeof tenantId !== "string" ||
                typeof featureKey !== "string"
              ) {
                throw new Error(
                  "Expected tenant ID and feature key.",
                );
              }

              const enabled = settings.get(
                settingKey(tenantId, featureKey),
              );

              return (
                enabled === undefined
                  ? null
                  : { enabled }
              ) as T | null;
            },

            run: async () => {
              if (
                !sql.includes(
                  "INSERT INTO tenant_feature_settings",
                )
              ) {
                throw new Error(
                  `Unexpected query in run(): ${sql}`,
                );
              }

              const [
                tenantId,
                featureKey,
                enabled,
              ] = values;

              if (
                typeof tenantId !== "string" ||
                typeof featureKey !== "string" ||
                typeof enabled !== "number"
              ) {
                throw new Error(
                  "Invalid feature setting parameters.",
                );
              }

              settings.set(
                settingKey(tenantId, featureKey),
                enabled,
              );

              return {
                success: true,
                meta: { changes: 1 },
              };
            },
          };
        },
      };
    },
  };

  return {
    db: fakeDb as unknown as D1Database,
    settings,
  };
}

test("registered features default to enabled", async () => {
  const { db } = createFakeDb();

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_chat",
    ),
    true,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_booking",
    ),
    true,
  );

  assert.equal(
    TENANT_FEATURES.ai_chat.defaultEnabled,
    true,
  );

  assert.equal(
    TENANT_FEATURES.ai_booking.defaultEnabled,
    true,
  );
});

test("AI Chat and AI Booking settings are independent", async () => {
  const { db } = createFakeDb();

  await setTenantFeatureEnabled(
    db,
    "tenant-a",
    "ai_chat",
    false,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_chat",
    ),
    false,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_booking",
    ),
    true,
  );

  await setTenantFeatureEnabled(
    db,
    "tenant-a",
    "ai_booking",
    false,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_booking",
    ),
    false,
  );
});

test("one tenant's settings do not affect another tenant", async () => {
  const { db } = createFakeDb();

  await setTenantFeatureEnabled(
    db,
    "tenant-a",
    "ai_chat",
    false,
  );

  await setTenantFeatureEnabled(
    db,
    "tenant-b",
    "ai_chat",
    true,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-a",
      "ai_chat",
    ),
    false,
  );

  assert.equal(
    await isTenantFeatureEnabled(
      db,
      "tenant-b",
      "ai_chat",
    ),
    true,
  );
});

test("feature key validation accepts registered keys only", () => {
  assert.equal(isTenantFeatureKey("ai_chat"), true);
  assert.equal(isTenantFeatureKey("ai_booking"), true);
  assert.equal(isTenantFeatureKey("unknown_feature"), false);
});

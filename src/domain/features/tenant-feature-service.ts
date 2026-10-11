export const TENANT_FEATURES = {
  ai_chat: {
    label: "AI Chat",
    description: "Generate ordinary AI chat responses.",
    defaultEnabled: true,
  },
  ai_booking: {
    label: "AI Booking",
    description: "Handle AI-assisted appointment bookings.",
    defaultEnabled: true,
  },
} as const;

export type TenantFeatureKey =
  keyof typeof TENANT_FEATURES;

export function isTenantFeatureKey(
  key: string,
): key is TenantFeatureKey {
  return Object.prototype.hasOwnProperty.call(
    TENANT_FEATURES,
    key,
  );
}

export async function isTenantFeatureEnabled(
  db: D1Database,
  tenantId: string,
  featureKey: TenantFeatureKey,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT enabled
       FROM tenant_feature_settings
       WHERE tenant_id = ?
         AND feature_key = ?
       LIMIT 1`,
    )
    .bind(tenantId, featureKey)
    .first<{ enabled: number }>();

  return row
    ? row.enabled === 1
    : TENANT_FEATURES[featureKey].defaultEnabled;
}

export async function setTenantFeatureEnabled(
  db: D1Database,
  tenantId: string,
  featureKey: TenantFeatureKey,
  enabled: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tenant_feature_settings (
         tenant_id,
         feature_key,
         enabled
       )
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, feature_key)
       DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      tenantId,
      featureKey,
      enabled ? 1 : 0,
    )
    .run();
}
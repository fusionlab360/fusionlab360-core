import type { D1Database } from "@cloudflare/workers-types";
import type { AppBindings } from "../../../config/app";

/** Only the known pre-0042 missing-column error permits legacy fallback. */
export function isMetaLifecycleSchemaMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /no such column:\s*(?:[A-Za-z_][\w]*\.)?activation_state\b|unknown column\s+['"`]?\w*\.?activation_state\b|has no column named\s+['"`]?activation_state\b/i.test(message);
}

/**
 * Keep pre-0042 databases compatible while preventing 0042 pending rows from
 * routing merely because lifecycle enforcement is still off. The feature gate
 * controls whether a historical legacy row needs explicit review; it does not
 * make a new pending connection eligible.
 */
export async function isMetaConnectionEligible(
  db: D1Database,
  env: Pick<AppBindings, "WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED">,
  tenantId: string,
  connectionId: string,
): Promise<boolean> {
  const lifecycleEnabled = env.WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED === "true";
  let row: { state: string } | null;
  try {
    row = await db.prepare(`
      SELECT c.activation_state AS state
      FROM meta_whatsapp_connections c
      JOIN integrations i ON i.id = c.integration_id
        AND i.tenant_id = c.tenant_id AND i.provider = 'meta_whatsapp'
      WHERE c.id = ? AND c.tenant_id = ? AND c.status = 'active'
    `).bind(connectionId, tenantId).first<{ state: string }>();
  } catch (error) {
    // The established pre-0042 deployment has no lifecycle column. Its
    // existing active-status and tenant checks remain authoritative until the
    // forward migration is applied. When enforcement is on, fail closed.
    return isMetaLifecycleSchemaMissing(error) && !lifecycleEnabled;
  }

  if (row?.state === "active") return true;
  if (row?.state === "legacy_active" && !lifecycleEnabled) return true;
  if (lifecycleEnabled && (row?.state === "legacy_active" || row?.state === "pending")) {
    try {
      const review = await db.prepare(`
        SELECT 1 AS reviewed
        FROM meta_whatsapp_legacy_approval_reviews review
        WHERE review.connection_id = ? AND review.tenant_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM meta_whatsapp_connection_activation_audit audit
            WHERE audit.connection_id = review.connection_id AND audit.tenant_id = review.tenant_id
              AND audit.new_state IN ('legacy_review_rejected', 'legacy_review_conflict')
          )
        LIMIT 1
      `).bind(connectionId, tenantId).first<{ reviewed: number }>();
      return review?.reviewed === 1;
    } catch {
      return false;
    }
  }
  return false;
}

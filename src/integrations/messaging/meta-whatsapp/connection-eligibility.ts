import type { D1Database } from "@cloudflare/workers-types";
import type { AppBindings } from "../../../config/app";

/** Consult the 0042 lifecycle only when explicitly enabled. Older production
 * databases continue using their established status and ownership checks. */
export async function isMetaConnectionEligible(
  db: D1Database,
  env: Pick<AppBindings, "WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED">,
  tenantId: string,
  connectionId: string,
): Promise<boolean> {
  if (env.WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED !== "true") return true;
  const row = await db.prepare(`
    SELECT c.activation_state AS state,
      EXISTS (
        SELECT 1 FROM meta_whatsapp_legacy_approval_reviews review
        WHERE review.connection_id = c.id AND review.tenant_id = c.tenant_id
      ) AND NOT EXISTS (
        SELECT 1 FROM meta_whatsapp_connection_activation_audit audit
        WHERE audit.connection_id = c.id AND audit.tenant_id = c.tenant_id
          AND audit.new_state IN ('legacy_review_rejected', 'legacy_review_conflict')
      ) AS reviewed
    FROM meta_whatsapp_connections c
    JOIN integrations i ON i.id = c.integration_id
      AND i.tenant_id = c.tenant_id AND i.provider = 'meta_whatsapp'
    WHERE c.id = ? AND c.tenant_id = ? AND c.status = 'active'
  `).bind(connectionId, tenantId).first<{ state: string; reviewed: number }>();
  return row?.state === "active" ||
    ((row?.state === "legacy_active" || row?.state === "pending") && row.reviewed === 1);
}

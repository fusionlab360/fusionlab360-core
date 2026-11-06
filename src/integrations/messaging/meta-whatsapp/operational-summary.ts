import type { D1Database } from "@cloudflare/workers-types";

/** Aggregate-only tenant diagnostics. Never select payloads, recipient IDs or provider responses. */
export async function readMetaWhatsAppOperationalSummary(db: D1Database, tenantId: string) {
  const events = await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN processing_status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
      SUM(CASE WHEN processing_attempts > 1 THEN 1 ELSE 0 END) AS retried,
      SUM(CASE WHEN processing_status IN ('received', 'processing')
        AND received_at < datetime('now', '-5 minutes') THEN 1 ELSE 0 END) AS backlog,
      SUM(CASE WHEN processing_status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failures,
      SUM(CASE WHEN last_error_code IN ('PROVIDER_IDENTITY_REJECTED', 'GHL_CONTACT_MISMATCH',
        'META_CONVERSATION_NOT_UNIQUE') THEN 1 ELSE 0 END) AS correlation_failures
    FROM integration_events
    WHERE tenant_id = ? AND event_type IN
      ('messaging.meta_whatsapp.inbound', 'messaging.meta_whatsapp.status', 'gohighlevel.provider_outbound_message')
  `).bind(tenantId).first<{ total: number; dead_letter: number | null; retried: number | null;
    backlog: number | null; failures: number | null; correlation_failures: number | null }>();
  const deliveries = await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
    FROM messaging_outbound_deliveries WHERE tenant_id = ? AND provider = 'meta_whatsapp'
  `).bind(tenantId).first<{ total: number; sent: number | null; failed: number | null; unknown: number | null }>();
  const deadLetters = await db.prepare(`
    SELECT COUNT(*) AS total FROM integration_event_dead_letters
    WHERE tenant_id = ? AND event_id IN (
      SELECT event_id FROM integration_events WHERE tenant_id = ? AND event_type IN
        ('messaging.meta_whatsapp.inbound', 'messaging.meta_whatsapp.status', 'gohighlevel.provider_outbound_message')
    )
  `).bind(tenantId, tenantId).first<{ total: number }>();
  const credentials = await db.prepare(`
    SELECT COUNT(*) AS expiring FROM meta_whatsapp_credentials
    WHERE tenant_id = ? AND provider = 'meta_whatsapp' AND status = 'active'
      AND json_type(metadata, '$.expiresAt') IN ('integer', 'real')
      AND json_extract(metadata, '$.expiresAt') <= ?
  `).bind(tenantId, Date.now() + 86400000).first<{ expiring: number }>();
  return {
    events: { total: events?.total ?? 0, deadLetter: events?.dead_letter ?? 0, retried: events?.retried ?? 0,
      backlog: events?.backlog ?? 0, failures: events?.failures ?? 0,
      correlationFailures: events?.correlation_failures ?? 0 },
    deliveries: { total: deliveries?.total ?? 0, sent: deliveries?.sent ?? 0,
      failed: deliveries?.failed ?? 0, unknown: deliveries?.unknown ?? 0 },
    deadLetters: deadLetters?.total ?? 0,
    credentialsExpiringWithin24Hours: credentials?.expiring ?? 0,
  };
}

export type MetaWhatsAppOperationalSummary = Awaited<ReturnType<typeof readMetaWhatsAppOperationalSummary>>;
export type MetaWhatsAppAlertCode = "INBOUND_BACKLOG" | "PROCESSING_FAILURES" |
  "OUTBOUND_FAILURES" | "DEAD_LETTERS" | "CREDENTIAL_EXPIRING" | "PROVIDER_CORRELATION_FAILURES";

function threshold(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]{0,4}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 10000 ? parsed : null;
}

/** Evaluation only. This function never delivers an alert or reads message content. */
export function evaluateMetaWhatsAppOperationalAlerts(
  summary: MetaWhatsAppOperationalSummary,
  config: { enabled?: string; backlog?: string; failures?: string; deadLetters?: string;
    credentialExpiry?: string; correlationFailures?: string },
): MetaWhatsAppAlertCode[] {
  if (config.enabled !== "true") return [];
  const rules: [MetaWhatsAppAlertCode, number, string | undefined][] = [
    ["INBOUND_BACKLOG", summary.events.backlog, config.backlog],
    ["PROCESSING_FAILURES", summary.events.failures, config.failures],
    ["OUTBOUND_FAILURES", summary.deliveries.failed + summary.deliveries.unknown, config.failures],
    ["DEAD_LETTERS", summary.deadLetters, config.deadLetters],
    ["CREDENTIAL_EXPIRING", summary.credentialsExpiringWithin24Hours, config.credentialExpiry],
    ["PROVIDER_CORRELATION_FAILURES", summary.events.correlationFailures, config.correlationFailures],
  ];
  const alerts: MetaWhatsAppAlertCode[] = [];
  for (const [code, count, raw] of rules) {
    const limit = threshold(raw);
    if (limit !== null && count >= limit) alerts.push(code);
  }
  return alerts;
}

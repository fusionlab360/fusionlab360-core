import type { MetaWhatsAppAlertCode } from "./operational-summary";

export interface MetaWhatsAppOperationalAlert {
  tenantId: string;
  code: MetaWhatsAppAlertCode;
  idempotencyKey: string;
}

export type MetaWhatsAppAlertSink = (alert: MetaWhatsAppOperationalAlert) => Promise<void>;

/**
 * Explicit delivery seam for a future authorized operator notifier. There is
 * no production sink wired to this function and no customer content in alerts.
 */
export async function deliverMetaWhatsAppOperationalAlerts(input: {
  enabled: boolean;
  tenantId: string;
  codes: readonly MetaWhatsAppAlertCode[];
  periodStartUtc: string;
  sink?: MetaWhatsAppAlertSink;
}): Promise<number> {
  if (!input.enabled || !input.sink) return 0;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.tenantId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(input.periodStartUtc)) {
    throw new Error("Invalid operational alert identity.");
  }
  let delivered = 0;
  for (const code of new Set(input.codes)) {
    await input.sink({ tenantId: input.tenantId, code,
      idempotencyKey: `waba:${input.tenantId}:${code}:${input.periodStartUtc}` });
    delivered++;
  }
  return delivered;
}

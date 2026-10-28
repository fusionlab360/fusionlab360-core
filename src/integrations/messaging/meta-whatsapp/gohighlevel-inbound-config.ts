export interface MetaWhatsAppGHLInboundConfiguration {
  META_WHATSAPP_GHL_INBOUND_ENABLED?: string;
  META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST?: string;
}

const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function resolveMetaWhatsAppGHLInboundTenant(
  value: string | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.includes(",") || normalized.includes("*") || !TENANT_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isMetaWhatsAppGHLInboundEnabled(
  configuration: MetaWhatsAppGHLInboundConfiguration,
  tenantId: string,
): boolean {
  return configuration.META_WHATSAPP_GHL_INBOUND_ENABLED === "true" &&
    resolveMetaWhatsAppGHLInboundTenant(configuration.META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST) === tenantId.trim();
}

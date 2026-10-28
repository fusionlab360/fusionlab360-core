export interface MetaWhatsAppDeveloperTestConfiguration {
  META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED?: string;
  META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST?: string;
}

const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const META_ASSET_ID_PATTERN = /^\d{8,32}$/;

function singleConfiguredValue(
  value: string | undefined,
  pattern: RegExp,
): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.includes(",") || normalized.includes("*") || !pattern.test(normalized)) {
    return null;
  }
  return normalized;
}

/** Developer test tokens are opt-in and constrained to one exact asset tuple. */
export function isMetaWhatsAppDeveloperTestAuthorized(
  configuration: MetaWhatsAppDeveloperTestConfiguration,
  input: { tenantId: string; wabaId: string; phoneNumberId: string },
): boolean {
  if (configuration.META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED !== "true") {
    return false;
  }

  const tenantId = singleConfiguredValue(
    configuration.META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST,
    TENANT_ID_PATTERN,
  );
  const wabaId = singleConfiguredValue(
    configuration.META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST,
    META_ASSET_ID_PATTERN,
  );
  const phoneNumberId = singleConfiguredValue(
    configuration.META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST,
    META_ASSET_ID_PATTERN,
  );

  return Boolean(
    tenantId && wabaId && phoneNumberId &&
    input.tenantId.trim() === tenantId &&
    input.wabaId.trim() === wabaId &&
    input.phoneNumberId.trim() === phoneNumberId,
  );
}

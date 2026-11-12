export interface MetaWhatsAppDeveloperTestConfiguration {
  META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED?: string;
  META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST?: string;
  META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST?: string;
  WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST?: string;
  WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST?: string;
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

function evidenceReferences(configurationValue: string | undefined): Set<string> {
  return new Set((configurationValue ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

function tenantScopedEvidenceKey(tenantId: string, evidenceReference: string): string {
  return `${tenantId}:${evidenceReference}`;
}

/**
 * Test binding evidence is a separate authority. Reject references also
 * configured for production review or activation so configuration overlap
 * cannot promote a test-only authorization into a production decision.
 */
export function isMetaWhatsAppDeveloperTestBindingEvidenceAuthorized(
  configuration: MetaWhatsAppDeveloperTestConfiguration,
  input: { tenantId: string; evidenceReference: string },
): boolean {
  const key = tenantScopedEvidenceKey(input.tenantId, input.evidenceReference);
  return evidenceReferences(configuration.META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST).has(key) &&
    !evidenceReferences(configuration.WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST).has(key) &&
    !evidenceReferences(configuration.WABA_CONNECTION_ACTIVATION_EVIDENCE_ALLOWLIST).has(key);
}

/** Identifies a test-only reference even if it was accidentally copied to a production allowlist. */
export function isMetaWhatsAppDeveloperTestBindingEvidenceReference(
  configuration: MetaWhatsAppDeveloperTestConfiguration,
  input: { tenantId: string; evidenceReference: string },
): boolean {
  return evidenceReferences(configuration.META_WHATSAPP_DEVELOPER_TEST_BINDING_EVIDENCE_ALLOWLIST)
    .has(tenantScopedEvidenceKey(input.tenantId, input.evidenceReference));
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

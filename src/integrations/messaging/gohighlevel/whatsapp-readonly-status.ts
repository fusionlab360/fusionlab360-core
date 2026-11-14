import type { AppBindings } from "../../../config/app";
import { resolveMetaWhatsAppGHLInboundTenant } from "../meta-whatsapp/gohighlevel-inbound-config";
import { resolveSingleGHLProviderPilotLocation } from "./custom-provider-pilot-config";
import { MetaWhatsAppConnectionRepository } from "../meta-whatsapp/persistence/connection-repository";
import { MetaWhatsAppCredentialRepository } from "../meta-whatsapp/persistence/credential-repository";
import { classifyMetaWhatsAppCredentialLifecycle } from "../meta-whatsapp/credential-vault";

export interface WhatsAppReadonlyStatus {
  connectionRecord: "Present" | "Not available";
  connectionState: string;
  credentialRecord: "Present" | "Not available";
  credentialState: string;
  credentialConfigured: "Yes" | "No" | "Not available";
  credentialExpiryMetadata: string;
  providerConfiguration: string;
  providerGlobal: "Enabled" | "Disabled";
  providerLocationGate: "Allowed" | "Not allowed";
  providerOperationalVerification: "Not verified";
  inboundGlobal: "Enabled" | "Disabled";
  inboundTenantGate: "Allowed" | "Not allowed";
  inboundAvailability: string;
  outboundGlobal: "Enabled" | "Disabled";
  outboundAvailability: string;
  deliveryOperationalVerification: "Not verified";
  requirements: string[];
  lastVerified: "Not available";
  lastError: "Not available";
}

const connectionStates = new Set(["pending", "active", "disabled", "reauthorization_required"]);
const credentialStates = new Set(["active", "disabled", "revoked"]);

function storedState(value: string | undefined, allowed: Set<string>): string {
  return value && allowed.has(value) ? `${value} (stored)` : "Unknown";
}

/** Reads only pre-0042 status/metadata projections. Never unseals credentials. */
export async function readWhatsAppReadonlyStatus(
  env: AppBindings,
  tenantId: string,
  locationId: string,
  providerConfigured: boolean,
): Promise<WhatsAppReadonlyStatus> {
  const connection = await new MetaWhatsAppConnectionRepository(env.DB).findUniqueStatusByTenant(tenantId);
  const inboundGlobal = env.META_WHATSAPP_GHL_INBOUND_ENABLED === "true" ? "Enabled" : "Disabled";
  const outboundGlobal = env.GHL_META_WHATSAPP_OUTBOUND_ENABLED === "true" ? "Enabled" : "Disabled";
  const inboundTenantAllowed = resolveMetaWhatsAppGHLInboundTenant(
    env.META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST,
  ) === tenantId.trim();
  let credentialRecord: "Present" | "Not available" = "Not available";
  let credentialState = "Not available";
  let credentialConfigured: "Yes" | "No" | "Not available" = "Not available";
  let credentialExpiryMetadata = "Not available";

  if (connection) {
    const credential = await new MetaWhatsAppCredentialRepository(env.DB).findLifecycleForOwner({
      tenantId,
      integrationId: connection.integrationId,
      connectionId: connection.id,
    });
    if (credential) {
      credentialRecord = "Present";
      credentialState = storedState(credential.status, credentialStates);
      credentialConfigured = credential.configured ? "Yes" : "No";
      if (credential.status !== "active" || !credential.configured) {
        credentialExpiryMetadata = "Not verified";
      } else {
        try {
          const metadata: unknown = JSON.parse(credential.metadata);
          const lifecycle = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? classifyMetaWhatsAppCredentialLifecycle(metadata as Record<string, unknown>)
            : "MISSING_EXPIRY";
          credentialExpiryMetadata = lifecycle === "VALID_EXPIRING" || lifecycle === "VALID_VERIFIED_NON_EXPIRING"
            ? "Expiry metadata appears current; token not tested"
            : lifecycle === "EXPIRED"
              ? "Expiry metadata is expired"
              : "Not verified";
        } catch {
          credentialExpiryMetadata = "Not verified";
        }
      }
    }
  }

  const activeConnection = connection?.status === "active";
  const activeCredential = credentialState === "active (stored)";
  const credentialIsConfigured = credentialConfigured === "Yes";
  const currentExpiryMetadata = credentialExpiryMetadata === "Expiry metadata appears current; token not tested";
  const providerConfiguration = providerConfigured ? "Configured in stored settings" : "Not configured";
  const providerGlobal = env.GHL_CUSTOM_PROVIDER_ENABLED === "true" ? "Enabled" : "Disabled";
  const providerLocationGate = resolveSingleGHLProviderPilotLocation(
    env.GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST,
  ) === locationId.trim() ? "Allowed" : "Not allowed";
  const localReadiness = Boolean(connection && activeConnection && activeCredential && credentialIsConfigured && currentExpiryMetadata && providerConfigured && providerGlobal === "Enabled" && providerLocationGate === "Allowed");
  const inboundEnabled = inboundGlobal === "Enabled" && inboundTenantAllowed;
  const requirements: string[] = [];
  if (!connection) requirements.push("No Meta WhatsApp connection record is stored");
  else if (!activeConnection) requirements.push("Stored Meta connection state is not active");
  if (credentialRecord === "Not available") requirements.push("No Meta credential record is stored");
  else if (!activeCredential) requirements.push("Stored Meta credential state is not active");
  if (credentialConfigured !== "Yes") requirements.push("Encrypted Meta credential material is not configured");
  if (!currentExpiryMetadata) requirements.push("Credential expiry metadata is not verified as current");
  if (!providerConfigured) requirements.push("GHL Custom Conversation Provider is not configured in stored settings");
  if (providerGlobal === "Disabled") requirements.push("GHL Custom Conversation Provider pilot switch is disabled");
  if (providerLocationGate !== "Allowed") requirements.push("GHL Custom Conversation Provider is not allowlisted for this location");
  if (!inboundEnabled) requirements.push("Meta-to-GHL inbound is disabled by its global switch or tenant allowlist");
  if (outboundGlobal === "Disabled") requirements.push("GHL-to-Meta outbound is disabled by its global switch");
  requirements.push("Provider operation and message delivery have not been tested by this page");

  return {
    connectionRecord: connection ? "Present" : "Not available",
    connectionState: connection ? storedState(connection.status, connectionStates) : "Not available",
    credentialRecord,
    credentialState,
    credentialConfigured,
    credentialExpiryMetadata,
    providerConfiguration,
    providerGlobal,
    providerLocationGate,
    providerOperationalVerification: "Not verified",
    inboundGlobal,
    inboundTenantGate: inboundTenantAllowed ? "Allowed" : "Not allowed",
    inboundAvailability: !inboundEnabled ? "Disabled" : localReadiness ? "Not operationally verified" : "Unavailable",
    outboundGlobal,
    outboundAvailability: outboundGlobal === "Disabled"
      ? "Disabled"
      : localReadiness
        ? "Not verified; runtime recipient and service-window gates are not evaluated here"
        : "Unavailable",
    deliveryOperationalVerification: "Not verified",
    requirements,
    lastVerified: "Not available",
    lastError: "Not available",
  };
}

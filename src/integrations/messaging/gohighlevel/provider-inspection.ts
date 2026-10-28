import { ghlFetchAuthenticated } from "../../crm/gohighlevel/client";
import type { IntegrationContext } from "../../../context/integration";

export const GHL_PROVIDER_INSPECTION_TENANT = "gmmetro";
export const GHL_PROVIDER_INSPECTION_LOCATION = "Npx2IdDDRjXz2QW3Svx4";
export const GHL_PROVIDER_INSPECTION_ID = "6adf3e12b24f5676a1ef327b";

export interface GHLProviderInspectionResult {
  lookupSucceeded: boolean;
  expectedProviderPresent: boolean;
  registeredChannelType: "SMS" | "Email" | null;
  customProviderFlag: boolean | null;
  providerOwnershipVerified: boolean | null;
  errorCode: string | null;
}

function emptyResult(errorCode: string | null): GHLProviderInspectionResult {
  return {
    lookupSucceeded: false,
    expectedProviderPresent: false,
    registeredChannelType: null,
    customProviderFlag: null,
    providerOwnershipVerified: null,
    errorCode,
  };
}

function parseChannelResponse(value: unknown): GHLProviderInspectionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyResult("malformed_response");
  const root = value as Record<string, unknown>;
  const channel = root.conversationChannel;
  if (!channel || typeof channel !== "object" || Array.isArray(channel)) return emptyResult("malformed_response");
  const sms = (channel as Record<string, unknown>).SMS;
  if (!Array.isArray(sms)) return emptyResult("malformed_response");

  const matching = sms.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const provider = (entry as Record<string, unknown>).conversationProvider;
    return !!provider && typeof provider === "object" && !Array.isArray(provider) &&
      (provider as Record<string, unknown>)._id === GHL_PROVIDER_INSPECTION_ID;
  });
  if (!matching || typeof matching !== "object" || Array.isArray(matching)) {
    return {
      lookupSucceeded: true,
      expectedProviderPresent: false,
      registeredChannelType: null,
      customProviderFlag: null,
      providerOwnershipVerified: null,
      errorCode: "provider_not_found",
    };
  }

  const provider = (matching as Record<string, unknown>).conversationProvider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) return emptyResult("malformed_response");
  const record = provider as Record<string, unknown>;
  const registeredChannelType = record.type === "SMS" || record.type === "Email" ? record.type : null;
  const customProviderFlag = typeof record.isCustomConversationProvider === "boolean"
    ? record.isCustomConversationProvider
    : typeof record.custom === "boolean"
      ? record.custom
      : typeof record.isCustom === "boolean"
        ? record.isCustom
        : null;

  return {
    lookupSucceeded: true,
    expectedProviderPresent: true,
    registeredChannelType,
    customProviderFlag,
    // The channel response does not establish Marketplace app ownership.
    providerOwnershipVerified: null,
    errorCode: registeredChannelType ? null : "unexpected_provider_type",
  };
}

export async function inspectGHLProvider(
  context: IntegrationContext,
): Promise<GHLProviderInspectionResult> {
  const response = await ghlFetchAuthenticated<unknown>(
    context,
    `/locations/${encodeURIComponent(GHL_PROVIDER_INSPECTION_LOCATION)}/conversationChannels/SMS`,
    { headers: { Version: "2023-02-21" } },
  );
  return parseChannelResponse(response);
}

export function providerInspectionErrorCode(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : null;
  if (status === 401 || status === 403) return "upstream_authorization";
  if (status === 404) return "upstream_not_found";
  if (status === 429) return "upstream_rate_limited";
  if (typeof status === "number" && status >= 500) return "upstream_server_error";
  if (typeof status === "number") return "upstream_http_error";
  return "oauth_runtime_error";
}

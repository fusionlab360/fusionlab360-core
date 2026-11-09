import type { AppBindings } from "../../../config/app";
import { MetaWhatsAppOnboardingError, type MetaDeveloperTestAuthorizationProvider, type MetaPhoneNumberInspection, type MetaTokenInspection, type MetaVerifiedAuthorization, type MetaWhatsAppOnboardingProvider } from "./onboarding";

const VERSION = /^v\d+\.\d+$/;
type GraphStage = "authorization_exchange" | "meta_token_debug" | "meta_waba_access" | "meta_phone_membership" | "meta_phone_registration" | "meta_app_subscription";
interface GraphJsonResponse {
  body: Record<string, unknown>;
  upstreamHttpStatus: number;
  providerRequestId?: string;
}
function graphFailureCode(stage: GraphStage) {
  switch (stage) {
    case "authorization_exchange": return "meta_authorization_exchange_failed" as const;
    case "meta_token_debug": return "meta_token_debug_failed" as const;
    case "meta_waba_access": return "meta_waba_access_failed" as const;
    case "meta_phone_membership": return "meta_phone_membership_failed" as const;
    case "meta_phone_registration": return "meta_phone_registration_failed" as const;
    case "meta_app_subscription": return "meta_app_subscription_failed" as const;
  }
}
function safeProviderErrorCode(body: unknown): number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "number" && Number.isSafeInteger(code) && code >= 0 ? code : undefined;
}
function expiresAtFromDebug(info: Record<string, unknown>): number | undefined {
  const expiresAtSeconds = info.expires_at;
  return typeof expiresAtSeconds === "number" && Number.isSafeInteger(expiresAtSeconds) && expiresAtSeconds > 0
    ? expiresAtSeconds * 1000
    : undefined;
}
export class MetaWhatsAppGraphOnboardingProvider implements MetaWhatsAppOnboardingProvider, MetaDeveloperTestAuthorizationProvider {
  constructor(private readonly appId: string, private readonly appSecret: string, private readonly version: string, private readonly request: typeof fetch = fetch) {
    if (!appId.trim() || !appSecret.trim() || !VERSION.test(version)) throw new Error("Meta WhatsApp Graph onboarding is not configured.");
    this.appId = appId.trim();
    this.appSecret = appSecret.trim();
  }
  private async json(path: string, stage: GraphStage, init?: RequestInit): Promise<GraphJsonResponse> {
    let response: Response;
    try {
      const request = this.request;
      response = await request(`https://graph.facebook.com/${this.version}${path}`, {
        method: "GET",
        ...init,
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json", ...init?.headers },
      });
    } catch {
      throw new MetaWhatsAppOnboardingError("Meta provider request failed.", {
        stage,
        code: stage === "meta_token_debug" ? "meta_token_debug_transport_failed" : graphFailureCode(stage),
      });
    }
    const providerRequestId = response.headers.get("x-fb-request-id") ?? response.headers.get("x-fb-trace-id") ?? undefined;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new MetaWhatsAppOnboardingError("Meta provider request failed.", {
      stage,
      code: graphFailureCode(stage),
      upstreamHttpStatus: response.status,
      providerErrorCode: safeProviderErrorCode(body),
      providerRequestId,
    });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MetaWhatsAppOnboardingError("Meta provider response was malformed.", {
      stage,
      code: graphFailureCode(stage),
      upstreamHttpStatus: response.status,
      providerRequestId,
    });
    return { body: body as Record<string, unknown>, upstreamHttpStatus: response.status, providerRequestId };
  }
  async exchangeAuthorizationCode(code: string): Promise<MetaVerifiedAuthorization> {
    if (!code.trim()) throw new MetaWhatsAppOnboardingError("Meta authorization code is required.", { stage: "input_validation", code: "meta_input_invalid" });
    const exchange = new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, code: code.trim() });
    const tokenResponse = await this.json(`/oauth/access_token?${exchange.toString()}`, "authorization_exchange");
    const accessToken = typeof tokenResponse.body.access_token === "string" ? tokenResponse.body.access_token : "";
    if (!accessToken) throw new Error("Meta authorization exchange returned no access token.");
    const inspected = await this.inspectToken(accessToken);
    if (!inspected.appIdMatches) throw new MetaWhatsAppOnboardingError("Meta token validation failed.", { stage: "meta_app_validation", code: "meta_app_id_mismatch" });
    if (!inspected.valid) throw new MetaWhatsAppOnboardingError("Meta token validation failed.", { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" });
    const tokenExpiry = typeof tokenResponse.body.expires_in === "number" && tokenResponse.body.expires_in > 0
      ? Date.now() + tokenResponse.body.expires_in * 1000
      : undefined;
    // A zero/missing expiry is deliberately not considered a verified permanent token.
    // This provider has no trusted system-user-token attestation contract yet.
    return {
      accessToken,
      scopes: inspected.scopes,
      expiresAt: inspected.expiresAt ?? tokenExpiry,
      lifecycle: inspected.expiresAt || tokenExpiry ? "expiring" : "unverified_non_expiring",
    };
  }
  async inspectToken(accessToken: string): Promise<MetaTokenInspection> {
    const token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) throw new MetaWhatsAppOnboardingError("Meta token inspection requires a stored credential.", { stage: "input_validation", code: "meta_input_invalid" });
    const debugResponse = await this.json(`/debug_token?input_token=${encodeURIComponent(token)}`, "meta_token_debug", {
      headers: { Authorization: `Bearer ${this.appId}|${this.appSecret}` },
    });
    const data = debugResponse.body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new MetaWhatsAppOnboardingError("Meta token validation response is malformed.", {
      stage: "meta_token_debug",
      code: "meta_token_debug_failed",
      upstreamHttpStatus: debugResponse.upstreamHttpStatus,
      providerRequestId: debugResponse.providerRequestId,
    });
    const info = data as Record<string, unknown>;
    const scopes = Array.isArray(info.scopes) ? info.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    return {
      valid: info.is_valid === true,
      appIdMatches: info.app_id === this.appId,
      scopes,
      ...(expiresAtFromDebug(info) ? { expiresAt: expiresAtFromDebug(info) } : {}),
    };
  }
  async validateDeveloperTestToken(accessToken: string): Promise<MetaVerifiedAuthorization> {
    const token = typeof accessToken === "string" ? accessToken.trim() : "";
    if (!token) throw new MetaWhatsAppOnboardingError("Meta developer test token validation failed.", {
      stage: "input_validation",
      code: "meta_input_invalid",
    });
    const inspection = await this.inspectToken(token);
    if (!inspection.appIdMatches || !inspection.valid || !inspection.expiresAt || inspection.expiresAt <= Date.now() + 60_000) {
      throw new MetaWhatsAppOnboardingError(
        "Meta developer test token validation failed.",
        !inspection.appIdMatches
          ? { stage: "meta_app_validation", code: "meta_app_id_mismatch" }
          : { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" },
      );
    }
    return { accessToken: token, scopes: inspection.scopes, expiresAt: inspection.expiresAt, lifecycle: "expiring" };
  }
  async verifyWabaAccess(accessToken: string, wabaId: string): Promise<boolean> {
    const response = await this.json(`/${encodeURIComponent(wabaId)}?fields=id`, "meta_waba_access", { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.body.id === wabaId;
  }
  async listPhoneNumbers(accessToken: string, wabaId: string): Promise<readonly string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ fields: "id", limit: "100" });
      if (after) query.set("after", after);
      const response = await this.json(`/${encodeURIComponent(wabaId)}/phone_numbers?${query}`, "meta_phone_membership", { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = response.body.data;
      if (!Array.isArray(data)) return [];
      for (const item of data) {
        if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") ids.push((item as Record<string, unknown>).id as string);
      }
      const paging = response.body.paging;
      const cursors = paging && typeof paging === "object" && !Array.isArray(paging) ? (paging as Record<string, unknown>).cursors : undefined;
      const cursor = cursors && typeof cursors === "object" && !Array.isArray(cursors) ? (cursors as Record<string, unknown>).after : undefined;
      if (data.length < 100 || typeof cursor !== "string" || !cursor || cursor.length > 1024) break;
      after = cursor;
    }
    return ids;
  }
  async inspectPhoneNumber(accessToken: string, phoneNumberId: string): Promise<MetaPhoneNumberInspection> {
    const fields = "id,status,platform_type,code_verification_status";
    const response = await this.json(`/${encodeURIComponent(phoneNumberId)}?fields=${fields}`, "meta_phone_registration", { headers: { Authorization: `Bearer ${accessToken}` } });
    const safeValue = (value: unknown, allowed: readonly string[]): string | null =>
      typeof value === "string" && allowed.includes(value) ? value : null;
    return {
      id: typeof response.body.id === "string" ? response.body.id : null,
      status: safeValue(response.body.status, ["CONNECTED", "PENDING", "DELETED", "MIGRATED", "BANNED", "RESTRICTED", "RATE_LIMITED", "FLAGGED", "DISCONNECTED", "UNKNOWN", "UNVERIFIED"]),
      platformType: safeValue(response.body.platform_type, ["CLOUD_API", "ON_PREMISE", "NOT_APPLICABLE"]),
      codeVerificationStatus: safeValue(response.body.code_verification_status, ["VERIFIED", "NOT_VERIFIED", "EXPIRED"]),
    };
  }
  async verifyWebhookSubscription(accessToken: string, wabaId: string): Promise<boolean> {
    const response = await this.json(`/${encodeURIComponent(wabaId)}/subscribed_apps`, "meta_app_subscription", { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = response.body.data;
    if (!Array.isArray(data)) return false;
    return data.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const apiData = (item as Record<string, unknown>).whatsapp_business_api_data;
      return !!apiData && typeof apiData === "object" && !Array.isArray(apiData) && (apiData as Record<string, unknown>).id === this.appId;
    });
  }
}
export function createMetaWhatsAppGraphOnboardingProvider(bindings: Pick<AppBindings, "META_WHATSAPP_APP_ID" | "META_WHATSAPP_APP_SECRET" | "META_WHATSAPP_GRAPH_API_VERSION">): MetaWhatsAppGraphOnboardingProvider {
  return new MetaWhatsAppGraphOnboardingProvider(bindings.META_WHATSAPP_APP_ID ?? "", bindings.META_WHATSAPP_APP_SECRET ?? "", bindings.META_WHATSAPP_GRAPH_API_VERSION ?? "");
}

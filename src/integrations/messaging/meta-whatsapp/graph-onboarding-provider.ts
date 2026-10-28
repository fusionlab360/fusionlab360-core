import type { AppBindings } from "../../../config/app";
import { MetaWhatsAppOnboardingError, type MetaDeveloperTestAuthorizationProvider, type MetaVerifiedAuthorization, type MetaWhatsAppOnboardingProvider } from "./onboarding";

const VERSION = /^v\d+\.\d+$/;
type GraphStage = "authorization_exchange" | "meta_token_debug" | "meta_waba_access" | "meta_phone_membership" | "meta_app_subscription";
function graphFailureCode(stage: GraphStage) {
  switch (stage) {
    case "authorization_exchange": return "meta_authorization_exchange_failed" as const;
    case "meta_token_debug": return "meta_token_debug_failed" as const;
    case "meta_waba_access": return "meta_waba_access_failed" as const;
    case "meta_phone_membership": return "meta_phone_membership_failed" as const;
    case "meta_app_subscription": return "meta_app_subscription_failed" as const;
  }
}
export class MetaWhatsAppGraphOnboardingProvider implements MetaWhatsAppOnboardingProvider, MetaDeveloperTestAuthorizationProvider {
  constructor(private readonly appId: string, private readonly appSecret: string, private readonly version: string, private readonly request: typeof fetch = fetch) {
    if (!appId.trim() || !appSecret.trim() || !VERSION.test(version)) throw new Error("Meta WhatsApp Graph onboarding is not configured.");
  }
  private async json(path: string, stage: GraphStage, init?: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.request(`https://graph.facebook.com/${this.version}${path}`, init);
    } catch {
      throw new MetaWhatsAppOnboardingError("Meta provider request failed.", {
        stage,
        code: graphFailureCode(stage),
      });
    }
    const providerRequestId = response.headers.get("x-fb-request-id") ?? response.headers.get("x-fb-trace-id") ?? undefined;
    if (!response.ok) throw new MetaWhatsAppOnboardingError("Meta provider request failed.", {
      stage,
      code: graphFailureCode(stage),
      upstreamHttpStatus: response.status,
      providerRequestId,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MetaWhatsAppOnboardingError("Meta provider response was malformed.", {
      stage,
      code: graphFailureCode(stage),
      providerRequestId,
    });
    return body as Record<string, unknown>;
  }
  async exchangeAuthorizationCode(code: string): Promise<MetaVerifiedAuthorization> {
    const token = await this.json(`/oauth/access_token?client_id=${encodeURIComponent(this.appId)}&client_secret=${encodeURIComponent(this.appSecret)}&code=${encodeURIComponent(code)}`, "authorization_exchange");
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    if (!accessToken) throw new Error("Meta authorization exchange returned no access token.");
    const debug = await this.json(`/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${this.appId}|${this.appSecret}`)}`, "meta_token_debug");
    const data = debug.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Meta token validation response is malformed.");
    const info = data as Record<string, unknown>;
    const scopes = Array.isArray(info.scopes) ? info.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    if (info.app_id !== this.appId) throw new MetaWhatsAppOnboardingError("Meta token validation failed.", { stage: "meta_app_validation", code: "meta_app_id_mismatch" });
    if (info.is_valid !== true) throw new MetaWhatsAppOnboardingError("Meta token validation failed.", { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" });
    return { accessToken, scopes, expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined };
  }
  async validateDeveloperTestToken(accessToken: string): Promise<MetaVerifiedAuthorization> {
    const token = accessToken.trim();
    if (!token) throw new Error("Meta developer test token is missing.");
    const debug = await this.json(`/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${this.appId}|${this.appSecret}`)}`, "meta_token_debug");
    const data = debug.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Meta token validation response is malformed.");
    const info = data as Record<string, unknown>;
    const scopes = Array.isArray(info.scopes) ? info.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const expiresAtSeconds = info.expires_at;
    if (
      info.app_id !== this.appId ||
      info.is_valid !== true ||
      typeof expiresAtSeconds !== "number" ||
      !Number.isSafeInteger(expiresAtSeconds) ||
      expiresAtSeconds * 1000 <= Date.now() + 60_000
    ) {
      throw new MetaWhatsAppOnboardingError(
        "Meta developer test token validation failed.",
        info.app_id !== this.appId
          ? { stage: "meta_app_validation", code: "meta_app_id_mismatch" }
          : { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" },
      );
    }
    return { accessToken: token, scopes, expiresAt: expiresAtSeconds * 1000 };
  }
  async verifyWabaAccess(accessToken: string, wabaId: string): Promise<boolean> { return (await this.json(`/${encodeURIComponent(wabaId)}?access_token=${encodeURIComponent(accessToken)}`, "meta_waba_access")).id === wabaId; }
  async listPhoneNumbers(accessToken: string, wabaId: string): Promise<readonly string[]> { const data = (await this.json(`/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`, "meta_phone_membership")).data; return Array.isArray(data) ? data.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" ? [(item as Record<string, unknown>).id as string] : []) : []; }
  async verifyWebhookSubscription(accessToken: string, wabaId: string): Promise<boolean> { return (await this.json(`/${encodeURIComponent(wabaId)}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`, "meta_app_subscription", { method: "POST" })).success === true; }
}
export function createMetaWhatsAppGraphOnboardingProvider(bindings: Pick<AppBindings, "META_WHATSAPP_APP_ID" | "META_WHATSAPP_APP_SECRET" | "META_WHATSAPP_GRAPH_API_VERSION">): MetaWhatsAppGraphOnboardingProvider {
  return new MetaWhatsAppGraphOnboardingProvider(bindings.META_WHATSAPP_APP_ID ?? "", bindings.META_WHATSAPP_APP_SECRET ?? "", bindings.META_WHATSAPP_GRAPH_API_VERSION ?? "");
}

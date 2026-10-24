import type { AppBindings } from "../../../config/app";
import type { MetaVerifiedAuthorization, MetaWhatsAppOnboardingProvider } from "./onboarding";

const VERSION = /^v\d+\.\d+$/;
export class MetaWhatsAppGraphOnboardingProvider implements MetaWhatsAppOnboardingProvider {
  constructor(private readonly appId: string, private readonly appSecret: string, private readonly version: string, private readonly request: typeof fetch = fetch) {
    if (!appId.trim() || !appSecret.trim() || !VERSION.test(version)) throw new Error("Meta WhatsApp Graph onboarding is not configured.");
  }
  private async json(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.request(`https://graph.facebook.com/${this.version}${path}`, init);
    if (!response.ok) throw new Error(`Meta Graph request failed with status ${response.status}.`);
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Meta Graph response is malformed.");
    return body as Record<string, unknown>;
  }
  async exchangeAuthorizationCode(code: string): Promise<MetaVerifiedAuthorization> {
    const token = await this.json(`/oauth/access_token?client_id=${encodeURIComponent(this.appId)}&client_secret=${encodeURIComponent(this.appSecret)}&code=${encodeURIComponent(code)}`);
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    if (!accessToken) throw new Error("Meta authorization exchange returned no access token.");
    const debug = await this.json(`/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${this.appId}|${this.appSecret}`)}`);
    const data = debug.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Meta token validation response is malformed.");
    const info = data as Record<string, unknown>;
    const scopes = Array.isArray(info.scopes) ? info.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    if (info.app_id !== this.appId || info.is_valid !== true) throw new Error("Meta token validation failed.");
    return { accessToken, scopes, expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined };
  }
  async verifyWabaAccess(accessToken: string, wabaId: string): Promise<boolean> { return (await this.json(`/${encodeURIComponent(wabaId)}?access_token=${encodeURIComponent(accessToken)}`)).id === wabaId; }
  async listPhoneNumbers(accessToken: string, wabaId: string): Promise<readonly string[]> { const data = (await this.json(`/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`)).data; return Array.isArray(data) ? data.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" ? [(item as Record<string, unknown>).id as string] : []) : []; }
  async verifyWebhookSubscription(accessToken: string, wabaId: string): Promise<boolean> { return (await this.json(`/${encodeURIComponent(wabaId)}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`, { method: "POST" })).success === true; }
}
export function createMetaWhatsAppGraphOnboardingProvider(bindings: Pick<AppBindings, "META_WHATSAPP_APP_ID" | "META_WHATSAPP_APP_SECRET" | "META_WHATSAPP_GRAPH_API_VERSION">): MetaWhatsAppGraphOnboardingProvider {
  return new MetaWhatsAppGraphOnboardingProvider(bindings.META_WHATSAPP_APP_ID ?? "", bindings.META_WHATSAPP_APP_SECRET ?? "", bindings.META_WHATSAPP_GRAPH_API_VERSION ?? "");
}

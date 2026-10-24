import type { D1Database } from "@cloudflare/workers-types";
import { createOAuthStateToken, hashOAuthStateToken } from "../../../core/security/oauth-state";
import { createMetaWhatsAppCredentialVault } from "./credential-vault";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { OAuthAuthorizationStateRepository } from "../../../persistence/repositories/oauth-authorization-state-repository";
import { IntegrationRepository } from "../../../persistence/repositories/integration-repository";
import type { AppBindings } from "../../../config/app";

export const META_ONBOARDING_PERMISSION = "integrations:oauth:connect";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUIRED_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"] as const;

export interface MetaVerifiedAuthorization {
  accessToken: string;
  scopes: readonly string[];
  expiresAt?: number;
}
export interface MetaWhatsAppOnboardingProvider {
  exchangeAuthorizationCode(code: string): Promise<MetaVerifiedAuthorization>;
  verifyWabaAccess(accessToken: string, wabaId: string): Promise<boolean>;
  listPhoneNumbers(accessToken: string, wabaId: string): Promise<readonly string[]>;
  verifyWebhookSubscription(accessToken: string, wabaId: string): Promise<boolean>;
}
export class MetaWhatsAppOnboardingError extends Error { constructor(message: string) { super(message); this.name = "MetaWhatsAppOnboardingError"; } }

function identifier(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function scopesIncludeRequired(scopes: readonly string[]): boolean { return REQUIRED_SCOPES.every((scope) => scopes.includes(scope)); }

export class MetaWhatsAppOnboardingService {
  constructor(private readonly db: D1Database, private readonly bindings: Pick<AppBindings, "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION">, private readonly provider: MetaWhatsAppOnboardingProvider) {}

  async start(input: { tenantId: string; operatorId: string; integrationId: string }): Promise<{ state: string; expiresAt: number }> {
    const integration = await new IntegrationRepository(this.db).findByTenantAndProvider(input.tenantId, "meta_whatsapp");
    if (!integration || integration.id !== input.integrationId) throw new MetaWhatsAppOnboardingError("Meta WhatsApp integration was not found.");
    const state = createOAuthStateToken();
    const expiresAt = Date.now() + STATE_TTL_MS;
    await new OAuthAuthorizationStateRepository(this.db).create({
      stateHash: await hashOAuthStateToken(state), tenantId: input.tenantId, integrationId: input.integrationId,
      provider: "meta_whatsapp", purpose: "embedded_signup", context: { operatorId: input.operatorId, action: "activate" }, expiresAt,
    });
    return { state, expiresAt };
  }

  async complete(input: { tenantId: string; operatorId: string; state: string; code: string; wabaId: string; phoneNumberId: string }): Promise<{ connectionId: string; status: "active"; credentialVersion: number }> {
    const state = await new OAuthAuthorizationStateRepository(this.db).consume(await hashOAuthStateToken(input.state));
    if (!state || state.provider !== "meta_whatsapp" || state.purpose !== "embedded_signup" || state.tenantId !== input.tenantId || state.context.operatorId !== input.operatorId || state.context.action !== "activate") throw new MetaWhatsAppOnboardingError("Onboarding state is invalid, expired, already used, or does not belong to this operator.");
    const code = identifier(input.code); const wabaId = identifier(input.wabaId); const phoneNumberId = identifier(input.phoneNumberId);
    if (!code || !wabaId || !phoneNumberId) throw new MetaWhatsAppOnboardingError("Onboarding completion is incomplete.");
    const authorization = await this.provider.exchangeAuthorizationCode(code);
    if (!authorization.accessToken?.trim() || !scopesIncludeRequired(authorization.scopes)) throw new MetaWhatsAppOnboardingError("Meta authorization does not include the required permissions.");
    const [hasWaba, phones, subscribed] = await Promise.all([
      this.provider.verifyWabaAccess(authorization.accessToken, wabaId), this.provider.listPhoneNumbers(authorization.accessToken, wabaId), this.provider.verifyWebhookSubscription(authorization.accessToken, wabaId),
    ]);
    if (!hasWaba || !phones.includes(phoneNumberId) || !subscribed) throw new MetaWhatsAppOnboardingError("Meta ownership or webhook subscription verification failed.");
    const integrations = new IntegrationRepository(this.db);
    const integration = await integrations.findByTenantAndProvider(input.tenantId, "meta_whatsapp");
    if (!integration || integration.id !== state.integrationId) throw new MetaWhatsAppOnboardingError("The Meta WhatsApp integration no longer matches this onboarding attempt.");
    const connections = new MetaWhatsAppConnectionRepository(this.db);
    let connection = await connections.findByTenantIntegrationAndPhoneNumberId(input.tenantId, integration.id, phoneNumberId);
    if (!connection) {
      const id = crypto.randomUUID();
      if (!await connections.createPending({ id, tenantId: input.tenantId, integrationId: integration.id, wabaId, phoneNumberId })) throw new MetaWhatsAppOnboardingError("The Meta phone number is already assigned.");
      connection = await connections.findByTenantAndId(input.tenantId, id);
    }
    if (!connection || connection.wabaId !== wabaId || !["pending", "active", "disabled", "reauthorization_required"].includes(connection.status)) throw new MetaWhatsAppOnboardingError("The Meta connection is not eligible for activation.");
    const vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    const owner = { tenantId: input.tenantId, integrationId: integration.id, connectionId: connection.id, provider: "meta_whatsapp" };
    const current = await vault.metadata(owner);
    const usable = current?.status === "disabled" ? await vault.enable({ ...owner, expectedVersion: current.credentialVersion }) : current;
    const credential = usable
      ? await vault.replace({ ...owner, accessToken: authorization.accessToken, metadata: { scopes: authorization.scopes, expiresAt: authorization.expiresAt }, expectedVersion: usable.credentialVersion })
      : await vault.create({ ...owner, accessToken: authorization.accessToken, metadata: { scopes: authorization.scopes, expiresAt: authorization.expiresAt } });
    if (connection.status !== "active" && !await connections.setStatus(input.tenantId, connection.id, connection.status, "active")) throw new MetaWhatsAppOnboardingError("Meta credential was stored but connection activation was not completed; retry authorization recovery.");
    return { connectionId: connection.id, status: "active", credentialVersion: credential.credentialVersion };
  }

  async disable(input: { tenantId: string; integrationId: string; connectionId: string; expectedCredentialVersion: number }): Promise<void> {
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection || connection.integrationId !== input.integrationId || connection.status !== "active") throw new MetaWhatsAppOnboardingError("The Meta connection is not eligible for disablement.");
    const vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    await vault.disable({ tenantId: input.tenantId, integrationId: input.integrationId, connectionId: input.connectionId, provider: "meta_whatsapp", expectedVersion: input.expectedCredentialVersion });
    if (!await new MetaWhatsAppConnectionRepository(this.db).setStatus(input.tenantId, input.connectionId, "active", "disabled")) throw new MetaWhatsAppOnboardingError("Meta credential was disabled but connection disablement was not completed.");
  }
}

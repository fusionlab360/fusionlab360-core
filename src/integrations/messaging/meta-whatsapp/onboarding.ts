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
export interface MetaDeveloperTestAuthorizationProvider {
  validateDeveloperTestToken(accessToken: string): Promise<MetaVerifiedAuthorization>;
}

export type MetaOnboardingDiagnosticStage =
  | "state_consumption"
  | "input_validation"
  | "meta_token_debug"
  | "meta_app_validation"
  | "meta_scope_validation"
  | "meta_waba_access"
  | "meta_phone_membership"
  | "meta_app_subscription"
  | "credential_encryption"
  | "connection_persistence"
  | "connection_activation"
  | "authorization_exchange"
  | "unknown";

export type MetaOnboardingDiagnosticCode =
  | "meta_token_debug_failed"
  | "meta_token_debug_transport_failed"
  | "meta_app_id_mismatch"
  | "meta_token_invalid_or_expired"
  | "meta_required_scopes_missing"
  | "meta_waba_access_failed"
  | "meta_phone_membership_failed"
  | "meta_app_subscription_failed"
  | "meta_credential_encryption_failed"
  | "meta_connection_persistence_failed"
  | "meta_connection_activation_failed"
  | "meta_authorization_exchange_failed"
  | "meta_state_invalid"
  | "meta_input_invalid"
  | "meta_unknown_failure";

export interface MetaOnboardingDiagnostic {
  stage: MetaOnboardingDiagnosticStage;
  code: MetaOnboardingDiagnosticCode;
  upstreamHttpStatus?: number;
  providerErrorCode?: number;
  providerRequestId?: string;
}

function safeProviderRequestId(value: string | null | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

export class MetaWhatsAppOnboardingError extends Error {
  readonly diagnostic: MetaOnboardingDiagnostic;

  constructor(message: string, diagnostic: MetaOnboardingDiagnostic = {
    stage: "input_validation",
    code: "meta_input_invalid",
  }) {
    super(message);
    this.name = "MetaWhatsAppOnboardingError";
    this.diagnostic = {
      ...diagnostic,
      providerRequestId: safeProviderRequestId(diagnostic.providerRequestId),
    };
  }
}

export function classifyMetaOnboardingError(
  error: unknown,
  diagnostic: MetaOnboardingDiagnostic,
  message: string,
): MetaWhatsAppOnboardingError {
  if (error instanceof MetaWhatsAppOnboardingError) return error;
  return new MetaWhatsAppOnboardingError(message, diagnostic);
}

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
    return this.completeAuthorized(
      input,
      false,
      () => this.provider.exchangeAuthorizationCode(input.code),
    );
  }

  async completeDeveloperTest(
    input: { tenantId: string; operatorId: string; state: string; accessToken: string; wabaId: string; phoneNumberId: string },
    provider: MetaDeveloperTestAuthorizationProvider,
  ): Promise<{ connectionId: string; status: "active"; credentialVersion: number }> {
    return this.completeAuthorized(input, true, async () => {
      let authorization: MetaVerifiedAuthorization;
      try {
        authorization = await provider.validateDeveloperTestToken(input.accessToken);
      } catch (error) {
        throw classifyMetaOnboardingError(
          error,
          { stage: "meta_token_debug", code: "meta_token_debug_failed" },
          "Meta developer test token validation failed.",
        );
      }
      if (!authorization.expiresAt || authorization.expiresAt <= Date.now() + 60_000) {
        throw new MetaWhatsAppOnboardingError(
          "Meta developer test token is expired or has no usable expiration.",
          { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" },
        );
      }
      return authorization;
    });
  }

  private async completeAuthorized(
    input: { tenantId: string; operatorId: string; state: string; wabaId: string; phoneNumberId: string },
    developerTest: boolean,
    loadAuthorization: () => Promise<MetaVerifiedAuthorization>,
  ): Promise<{ connectionId: string; status: "active"; credentialVersion: number }> {
    const state = await new OAuthAuthorizationStateRepository(this.db).consume(await hashOAuthStateToken(input.state));
    if (!state || state.provider !== "meta_whatsapp" || state.purpose !== "embedded_signup" || state.tenantId !== input.tenantId || state.context.operatorId !== input.operatorId || state.context.action !== "activate") {
      throw new MetaWhatsAppOnboardingError(
        "Onboarding state is invalid, expired, already used, or does not belong to this operator.",
        { stage: "state_consumption", code: "meta_state_invalid" },
      );
    }
    const wabaId = identifier(input.wabaId); const phoneNumberId = identifier(input.phoneNumberId);
    if (!wabaId || !phoneNumberId) throw new MetaWhatsAppOnboardingError("Onboarding completion is incomplete.", { stage: "input_validation", code: "meta_input_invalid" });
    let authorization: MetaVerifiedAuthorization;
    try {
      authorization = await loadAuthorization();
    } catch (error) {
      throw classifyMetaOnboardingError(
        error,
        { stage: "authorization_exchange", code: "meta_authorization_exchange_failed" },
        "Meta authorization could not be validated.",
      );
    }
    if (!authorization.accessToken?.trim() || !scopesIncludeRequired(authorization.scopes)) {
      throw new MetaWhatsAppOnboardingError(
        "Meta authorization does not include the required permissions.",
        { stage: "meta_scope_validation", code: "meta_required_scopes_missing" },
      );
    }
    let hasWaba: boolean;
    let phones: readonly string[];
    let subscribed: boolean;
    try {
      [hasWaba, phones, subscribed] = await Promise.all([
        this.provider.verifyWabaAccess(authorization.accessToken, wabaId),
        this.provider.listPhoneNumbers(authorization.accessToken, wabaId),
        this.provider.verifyWebhookSubscription(authorization.accessToken, wabaId),
      ]);
    } catch (error) {
      throw classifyMetaOnboardingError(
        error,
        { stage: "meta_waba_access", code: "meta_waba_access_failed" },
        "Meta ownership or webhook subscription verification failed.",
      );
    }
    if (!hasWaba) throw new MetaWhatsAppOnboardingError("Meta ownership or webhook subscription verification failed.", { stage: "meta_waba_access", code: "meta_waba_access_failed" });
    if (!phones.includes(phoneNumberId)) throw new MetaWhatsAppOnboardingError("Meta ownership or webhook subscription verification failed.", { stage: "meta_phone_membership", code: "meta_phone_membership_failed" });
    if (!subscribed) throw new MetaWhatsAppOnboardingError("Meta ownership or webhook subscription verification failed.", { stage: "meta_app_subscription", code: "meta_app_subscription_failed" });
    const integrations = new IntegrationRepository(this.db);
    const integration = await integrations.findByTenantAndProvider(input.tenantId, "meta_whatsapp");
    if (!integration || integration.id !== state.integrationId) throw new MetaWhatsAppOnboardingError("The Meta WhatsApp integration no longer matches this onboarding attempt.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    const connections = new MetaWhatsAppConnectionRepository(this.db);
    let connection = await connections.findByTenantIntegrationAndPhoneNumberId(input.tenantId, integration.id, phoneNumberId);
    if (!connection) {
      const id = crypto.randomUUID();
      try {
        if (!await connections.createPending({ id, tenantId: input.tenantId, integrationId: integration.id, wabaId, phoneNumberId })) throw new MetaWhatsAppOnboardingError("The Meta phone number is already assigned.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
      } catch (error) {
        throw classifyMetaOnboardingError(error, { stage: "connection_persistence", code: "meta_connection_persistence_failed" }, "Meta connection could not be persisted.");
      }
      connection = await connections.findByTenantAndId(input.tenantId, id);
    }
    if (!connection || connection.wabaId !== wabaId || !["pending", "active", "disabled", "reauthorization_required"].includes(connection.status)) throw new MetaWhatsAppOnboardingError("The Meta connection is not eligible for activation.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    let vault: ReturnType<typeof createMetaWhatsAppCredentialVault>;
    try {
      vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential encryption is unavailable.");
    }
    const owner = { tenantId: input.tenantId, integrationId: integration.id, connectionId: connection.id, provider: "meta_whatsapp" };
    let current;
    try {
      current = await vault.metadata(owner);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential metadata could not be read.");
    }
    let usable = current;
    if (current?.status === "disabled") {
      try {
        usable = await vault.enable({ ...owner, expectedVersion: current.credentialVersion });
      } catch (error) {
        throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential could not be enabled.");
      }
    }
    let credential;
    try {
      credential = usable
        ? await vault.replace({ ...owner, accessToken: authorization.accessToken, metadata: { scopes: authorization.scopes, expiresAt: authorization.expiresAt, ...(developerTest ? { developerTest: true } : {}) }, expectedVersion: usable.credentialVersion })
        : await vault.create({ ...owner, accessToken: authorization.accessToken, metadata: { scopes: authorization.scopes, expiresAt: authorization.expiresAt, ...(developerTest ? { developerTest: true } : {}) } });
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential could not be persisted.");
    }
    if (connection.status !== "active") {
      try {
        if (!await connections.setStatus(input.tenantId, connection.id, connection.status, "active")) throw new Error("connection activation rejected");
      } catch (error) {
        throw classifyMetaOnboardingError(error, { stage: "connection_activation", code: "meta_connection_activation_failed" }, "Meta credential was stored but connection activation was not completed; retry authorization recovery.");
      }
    }
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

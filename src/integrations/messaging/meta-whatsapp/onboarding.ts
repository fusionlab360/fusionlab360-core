import type { D1Database } from "@cloudflare/workers-types";
import { createOAuthStateToken, hashOAuthStateToken } from "../../../core/security/oauth-state";
import {
  createMetaWhatsAppCredentialVault,
  MetaWhatsAppCredentialError,
  type MetaWhatsAppCredentialLifecycle,
} from "./credential-vault";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { OAuthAuthorizationStateRepository } from "../../../persistence/repositories/oauth-authorization-state-repository";
import { IntegrationRepository } from "../../../persistence/repositories/integration-repository";
import type { AppBindings } from "../../../config/app";
import { isMetaLifecycleSchemaMissing } from "./connection-eligibility";
import { isMetaWhatsAppDeveloperTestAuthorized } from "./developer-test-config";

export const META_ONBOARDING_PERMISSION = "integrations:oauth:connect";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUIRED_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"] as const;

export interface MetaVerifiedAuthorization {
  accessToken: string;
  scopes: readonly string[];
  expiresAt?: number;
  /** Provider-sourced lifecycle evidence; never accepted directly from an API request. */
  lifecycle?: MetaWhatsAppCredentialLifecycle;
}
export interface MetaTokenInspection {
  valid: boolean;
  appIdMatches: boolean;
  scopes: readonly string[];
  expiresAt?: number;
}
export interface MetaPhoneNumberInspection {
  id: string | null;
  status: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
}
export interface MetaWhatsAppOnboardingProvider {
  exchangeAuthorizationCode(code: string): Promise<MetaVerifiedAuthorization>;
  inspectToken(accessToken: string): Promise<MetaTokenInspection>;
  verifyWabaAccess(accessToken: string, wabaId: string): Promise<boolean>;
  listPhoneNumbers(accessToken: string, wabaId: string): Promise<readonly string[]>;
  inspectPhoneNumber(accessToken: string, phoneNumberId: string): Promise<MetaPhoneNumberInspection>;
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
  | "meta_phone_registration"
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
  | "meta_phone_registration_failed"
  | "meta_app_subscription_failed"
  | "meta_credential_encryption_failed"
  | "meta_connection_persistence_failed"
  | "meta_connection_activation_failed"
  | "meta_lifecycle_schema_required"
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

export type MetaAssetCheckStatus = "passed" | "failed" | "unavailable" | "not_checked";
export interface MetaAssetCheck {
  status: MetaAssetCheckStatus;
  code: string;
  action: string;
}
export interface MetaWhatsAppConnectionVerification {
  connectionId: string;
  ready: boolean;
  checks: {
    tokenValidity: MetaAssetCheck;
    requiredPermissions: MetaAssetCheck & { missing?: string[] };
    expectedWabaAccess: MetaAssetCheck;
    phoneMembership: MetaAssetCheck;
    phoneRegistration: MetaAssetCheck & { providerStatus?: string; platformType?: string; codeVerificationStatus?: string };
    appSubscription: MetaAssetCheck;
  };
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
  constructor(private readonly db: D1Database, private readonly bindings: Pick<AppBindings, "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION" | "META_WHATSAPP_DEVELOPER_TEST_ONBOARDING_ENABLED" | "META_WHATSAPP_DEVELOPER_TEST_TENANT_ALLOWLIST" | "META_WHATSAPP_DEVELOPER_TEST_WABA_ID_ALLOWLIST" | "META_WHATSAPP_DEVELOPER_TEST_PHONE_NUMBER_ID_ALLOWLIST">, private readonly provider: MetaWhatsAppOnboardingProvider) {}

  async refreshDeveloperTestCredential(
    input: { tenantId: string; connectionId: string; accessToken: string },
    provider: MetaWhatsAppOnboardingProvider & MetaDeveloperTestAuthorizationProvider,
  ): Promise<{ connectionId: string; credentialVersion: number; expiresAt: number }> {
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection || connection.status !== "active") {
      throw new MetaWhatsAppOnboardingError("Meta WhatsApp connection is unavailable for credential refresh.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    }
    if (!isMetaWhatsAppDeveloperTestAuthorized(this.bindings, {
      tenantId: input.tenantId,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
    })) {
      throw new MetaWhatsAppOnboardingError("Meta developer test credential refresh is unavailable.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    }

    let activationState: string | null;
    try {
      const row = await this.db.prepare(`
        SELECT activation_state AS state FROM meta_whatsapp_connections
        WHERE tenant_id = ? AND id = ? LIMIT 1
      `).bind(input.tenantId, connection.id).first<{ state: string }>();
      activationState = row?.state ?? null;
    } catch {
      throw new MetaWhatsAppOnboardingError("Meta connection lifecycle state could not be verified.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    }
    if (!activationState || activationState === "suspended" || activationState === "revoked") {
      throw new MetaWhatsAppOnboardingError("Meta WhatsApp connection is unavailable for credential refresh.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    }

    const owner = { tenantId: input.tenantId, integrationId: connection.integrationId, connectionId: connection.id, provider: "meta_whatsapp" };
    const vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    let current;
    try {
      current = await vault.metadata(owner);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential metadata could not be verified.");
    }
    if (!current || current.status !== "active" || current.metadata.developerTest !== true) {
      throw new MetaWhatsAppOnboardingError("An active developer-test credential is required for refresh.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
    }

    let authorization: MetaVerifiedAuthorization;
    try {
      authorization = await provider.validateDeveloperTestToken(input.accessToken);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "meta_token_debug", code: "meta_token_debug_failed" }, "Meta developer test token validation failed.");
    }
    if (!authorization.accessToken?.trim() || !scopesIncludeRequired(authorization.scopes)) {
      throw new MetaWhatsAppOnboardingError("Meta authorization does not include the required permissions.", { stage: "meta_scope_validation", code: "meta_required_scopes_missing" });
    }
    if (!authorization.expiresAt || authorization.expiresAt <= Date.now() + 60_000) {
      throw new MetaWhatsAppOnboardingError("Meta developer test token is expired or has no usable expiration.", { stage: "meta_token_debug", code: "meta_token_invalid_or_expired" });
    }

    let hasWaba: boolean;
    let phones: readonly string[];
    let phone: MetaPhoneNumberInspection;
    let subscribed: boolean;
    try {
      [hasWaba, phones, phone, subscribed] = await Promise.all([
        this.provider.verifyWabaAccess(authorization.accessToken, connection.wabaId),
        this.provider.listPhoneNumbers(authorization.accessToken, connection.wabaId),
        this.provider.inspectPhoneNumber(authorization.accessToken, connection.phoneNumberId),
        this.provider.verifyWebhookSubscription(authorization.accessToken, connection.wabaId),
      ]);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "meta_waba_access", code: "meta_waba_access_failed" }, "Meta asset verification failed.");
    }
    if (!hasWaba || !phones.includes(connection.phoneNumberId)) {
      throw new MetaWhatsAppOnboardingError("Meta authorization does not match the existing WABA and phone number.", { stage: "meta_phone_membership", code: "meta_phone_membership_failed" });
    }
    if (phone.id !== connection.phoneNumberId || phone.status !== "CONNECTED" || phone.platformType !== "CLOUD_API" || phone.codeVerificationStatus !== "VERIFIED") {
      throw new MetaWhatsAppOnboardingError("The existing Meta phone number is not verified for Cloud API use.", { stage: "meta_phone_registration", code: "meta_phone_registration_failed" });
    }
    if (!subscribed) {
      throw new MetaWhatsAppOnboardingError("The Meta application is not subscribed to the existing WABA.", { stage: "meta_app_subscription", code: "meta_app_subscription_failed" });
    }

    const refreshed = await vault.replace({
      ...owner,
      accessToken: authorization.accessToken,
      expectedVersion: current.credentialVersion,
      metadata: { developerTest: true, lifecycle: "expiring", expiresAt: authorization.expiresAt, scopes: authorization.scopes },
    });
    return { connectionId: connection.id, credentialVersion: refreshed.credentialVersion, expiresAt: authorization.expiresAt };
  }

  async start(input: { tenantId: string; operatorId: string; integrationId: string; connectionId?: string }): Promise<{ state: string; expiresAt: number }> {
    const integration = await new IntegrationRepository(this.db).findByTenantAndProvider(input.tenantId, "meta_whatsapp");
    if (!integration || integration.id !== input.integrationId) throw new MetaWhatsAppOnboardingError("Meta WhatsApp integration was not found.");
    let stateContext: Record<string, unknown> = { operatorId: input.operatorId, action: "activate" };
    if (input.connectionId?.trim()) {
      const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId.trim());
      if (!connection || connection.integrationId !== integration.id || !["active", "disabled", "reauthorization_required"].includes(connection.status)) {
        throw new MetaWhatsAppOnboardingError("The existing Meta connection is not eligible for reauthorization.");
      }
      let activationState: string | null = null;
      try {
        const row = await this.db.prepare(`SELECT activation_state AS state FROM meta_whatsapp_connections WHERE tenant_id = ? AND id = ? LIMIT 1`)
          .bind(input.tenantId, connection.id).first<{ state: string }>();
        activationState = row?.state ?? null;
      } catch (error) {
        if (!isMetaLifecycleSchemaMissing(error)) throw new MetaWhatsAppOnboardingError("The Meta connection lifecycle state could not be verified.");
      }
      if (activationState === "suspended" || activationState === "revoked") {
        throw new MetaWhatsAppOnboardingError("Suspended or revoked Meta connections cannot be reauthorized.");
      }
      let vault: ReturnType<typeof createMetaWhatsAppCredentialVault>;
      try {
        vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
      } catch {
        throw new MetaWhatsAppOnboardingError("Meta credential encryption is unavailable.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
      }
      const credential = await vault.metadata({ tenantId: input.tenantId, integrationId: integration.id, connectionId: connection.id, provider: "meta_whatsapp" });
      if (!credential || credential.status === "revoked") {
        throw new MetaWhatsAppOnboardingError("The existing Meta credential cannot be reauthorized.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
      }
      stateContext = {
        operatorId: input.operatorId,
        action: "reauthorize",
        connectionId: connection.id,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        expectedCredentialVersion: credential.credentialVersion,
      };
    }
    const state = createOAuthStateToken();
    const expiresAt = Date.now() + STATE_TTL_MS;
    await new OAuthAuthorizationStateRepository(this.db).create({
      stateHash: await hashOAuthStateToken(state), tenantId: input.tenantId, integrationId: input.integrationId,
      provider: "meta_whatsapp", purpose: "embedded_signup", context: stateContext, expiresAt,
    });
    return { state, expiresAt };
  }

  async complete(input: { tenantId: string; operatorId: string; state: string; code: string; wabaId: string; phoneNumberId: string }): Promise<{ connectionId: string; status: "active"; activationState: string; credentialVersion: number }> {
    return this.completeAuthorized(
      input,
      false,
      () => this.provider.exchangeAuthorizationCode(input.code),
    );
  }

  async completeDeveloperTest(
    input: { tenantId: string; operatorId: string; state: string; accessToken: string; wabaId: string; phoneNumberId: string },
    provider: MetaDeveloperTestAuthorizationProvider,
  ): Promise<{ connectionId: string; status: "active"; activationState: string; credentialVersion: number }> {
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
  ): Promise<{ connectionId: string; status: "active"; activationState: string; credentialVersion: number }> {
    const state = await new OAuthAuthorizationStateRepository(this.db).consume(await hashOAuthStateToken(input.state));
    const action = state?.context.action;
    if (!state || state.provider !== "meta_whatsapp" || state.purpose !== "embedded_signup" || state.tenantId !== input.tenantId || state.context.operatorId !== input.operatorId || (action !== "activate" && action !== "reauthorize")) {
      throw new MetaWhatsAppOnboardingError(
        "Onboarding state is invalid, expired, already used, or does not belong to this operator.",
        { stage: "state_consumption", code: "meta_state_invalid" },
      );
    }
    const wabaId = identifier(input.wabaId); const phoneNumberId = identifier(input.phoneNumberId);
    if (!wabaId || !phoneNumberId) throw new MetaWhatsAppOnboardingError("Onboarding completion is incomplete.", { stage: "input_validation", code: "meta_input_invalid" });

    const integrations = new IntegrationRepository(this.db);
    const integration = await integrations.findByTenantAndProvider(input.tenantId, "meta_whatsapp");
    if (!integration) throw new MetaWhatsAppOnboardingError("Meta WhatsApp integration was not found.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    if (integration.id !== state.integrationId) throw new MetaWhatsAppOnboardingError("The Meta WhatsApp integration no longer matches this onboarding attempt.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    const connections = new MetaWhatsAppConnectionRepository(this.db);
    let connection = await connections.findByTenantIntegrationAndPhoneNumberId(input.tenantId, integration.id, phoneNumberId);
    if (action === "reauthorize") {
      const expectedConnectionId = identifier(state.context.connectionId);
      const expectedWabaId = identifier(state.context.wabaId);
      const expectedPhoneNumberId = identifier(state.context.phoneNumberId);
      const expectedCredentialVersion = state.context.expectedCredentialVersion;
      if (!expectedConnectionId || !expectedWabaId || !expectedPhoneNumberId ||
          typeof expectedCredentialVersion !== "number" || !Number.isSafeInteger(expectedCredentialVersion) || expectedCredentialVersion < 1 ||
          expectedWabaId !== wabaId || expectedPhoneNumberId !== phoneNumberId ||
          !connection || connection.id !== expectedConnectionId || connection.wabaId !== expectedWabaId) {
        throw new MetaWhatsAppOnboardingError("The reauthorization assets no longer match the existing Meta connection.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
      }
    } else if (connection) {
      throw new MetaWhatsAppOnboardingError("An existing Meta connection must be selected explicitly for reauthorization.", { stage: "connection_persistence", code: "meta_connection_persistence_failed" });
    }
    let lifecycleState: string | null = null;
    let lifecycleSchemaReady = true;
    try {
      const existingLifecycle = await this.db.prepare(`
        SELECT activation_state AS state FROM meta_whatsapp_connections
        WHERE tenant_id = ? AND id = ? LIMIT 1
      `).bind(input.tenantId, connection?.id ?? "").first<{ state: string }>();
      if (connection) lifecycleState = existingLifecycle?.state ?? null;
      if (connection && !existingLifecycle) lifecycleSchemaReady = false;
    } catch (error) {
      if (!isMetaLifecycleSchemaMissing(error)) {
        throw new MetaWhatsAppOnboardingError(
          "The Meta connection lifecycle state could not be verified.",
          { stage: "connection_persistence", code: "meta_connection_persistence_failed" },
        );
      }
      lifecycleSchemaReady = false;
    }
    if (!lifecycleSchemaReady && (!connection || connection.status !== "active")) {
      throw new MetaWhatsAppOnboardingError(
        "New Meta connections require the lifecycle schema and explicit activation.",
        { stage: "connection_persistence", code: "meta_lifecycle_schema_required" },
      );
    }
    if (lifecycleSchemaReady && connection && !lifecycleState) {
      throw new MetaWhatsAppOnboardingError(
        "The existing Meta connection lifecycle state could not be verified.",
        { stage: "connection_persistence", code: "meta_connection_persistence_failed" },
      );
    }
    if (lifecycleState === "suspended" || lifecycleState === "revoked") {
      throw new MetaWhatsAppOnboardingError(
        "Suspended or revoked Meta connections cannot be reactivated through onboarding.",
        { stage: "connection_persistence", code: "meta_connection_persistence_failed" },
      );
    }
    let vault: ReturnType<typeof createMetaWhatsAppCredentialVault>;
    try {
      vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential encryption is unavailable.");
    }
    const owner = connection
      ? { tenantId: input.tenantId, integrationId: integration.id, connectionId: connection.id, provider: "meta_whatsapp" }
      : null;
    if (action === "reauthorize" && owner) {
      const current = await vault.metadata(owner);
      if (!current || current.status === "revoked" || current.credentialVersion !== state.context.expectedCredentialVersion) {
        throw new MetaWhatsAppOnboardingError("The existing Meta credential changed after reauthorization started.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
      }
    }
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
    let phone: MetaPhoneNumberInspection;
    let subscribed: boolean;
    try {
      [hasWaba, phones, phone, subscribed] = await Promise.all([
        this.provider.verifyWabaAccess(authorization.accessToken, wabaId),
        this.provider.listPhoneNumbers(authorization.accessToken, wabaId),
        this.provider.inspectPhoneNumber(authorization.accessToken, phoneNumberId),
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
    if (phone.id !== phoneNumberId || phone.status !== "CONNECTED" || phone.platformType !== "CLOUD_API" || phone.codeVerificationStatus !== "VERIFIED") {
      throw new MetaWhatsAppOnboardingError("The Meta phone number is not registered and connected for Cloud API use.", { stage: "meta_phone_registration", code: "meta_phone_registration_failed" });
    }
    if (!subscribed) throw new MetaWhatsAppOnboardingError("Meta ownership or webhook subscription verification failed.", { stage: "meta_app_subscription", code: "meta_app_subscription_failed" });
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
    const credentialOwner = { tenantId: input.tenantId, integrationId: integration.id, connectionId: connection.id, provider: "meta_whatsapp" };
    let current;
    try {
      current = await vault.metadata(credentialOwner);
    } catch (error) {
      throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential metadata could not be read.");
    }
    if (action === "reauthorize" && current?.credentialVersion !== state.context.expectedCredentialVersion) {
      throw new MetaWhatsAppOnboardingError("The existing Meta credential changed during reauthorization.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
    }
    if (action === "reauthorize" && current?.status === "revoked") {
      throw new MetaWhatsAppOnboardingError("A revoked Meta credential cannot be reauthorized.", { stage: "credential_encryption", code: "meta_credential_encryption_failed" });
    }
    let usable = current;
    if (current?.status === "disabled") {
      try {
        usable = await vault.enable({ ...credentialOwner, expectedVersion: current.credentialVersion });
      } catch (error) {
        throw classifyMetaOnboardingError(error, { stage: "credential_encryption", code: "meta_credential_encryption_failed" }, "Meta credential could not be enabled.");
      }
    }
    let credential;
    try {
      const metadata = {
        scopes: authorization.scopes,
        expiresAt: authorization.expiresAt,
        ...(authorization.lifecycle ? { lifecycle: authorization.lifecycle } : {}),
        ...(authorization.lifecycle === "verified_non_expiring"
          ? { nonExpiringVerification: "provider_token_debug_verified" as const }
          : {}),
        ...(developerTest ? { developerTest: true, lifecycle: "expiring" as const } : {}),
      };
      credential = usable
        ? await vault.replace({ ...credentialOwner, accessToken: authorization.accessToken, metadata, expectedVersion: usable.credentialVersion })
        : await vault.create({ ...credentialOwner, accessToken: authorization.accessToken, metadata });
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
    return {
      connectionId: connection.id,
      status: "active",
      activationState: lifecycleSchemaReady ? lifecycleState ?? "pending" : "not_migrated",
      credentialVersion: credential.credentialVersion,
    };
  }

  async disable(input: { tenantId: string; integrationId: string; connectionId: string; expectedCredentialVersion: number }): Promise<void> {
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection || connection.integrationId !== input.integrationId || connection.status !== "active") throw new MetaWhatsAppOnboardingError("The Meta connection is not eligible for disablement.");
    const vault = createMetaWhatsAppCredentialVault(this.db, this.bindings);
    await vault.disable({ tenantId: input.tenantId, integrationId: input.integrationId, connectionId: input.connectionId, provider: "meta_whatsapp", expectedVersion: input.expectedCredentialVersion });
    if (!await new MetaWhatsAppConnectionRepository(this.db).setStatus(input.tenantId, input.connectionId, "active", "disabled")) throw new MetaWhatsAppOnboardingError("Meta credential was disabled but connection disablement was not completed.");
  }

  async verifyConnection(input: { tenantId: string; connectionId: string }): Promise<MetaWhatsAppConnectionVerification> {
    const connection = await new MetaWhatsAppConnectionRepository(this.db).findByTenantAndId(input.tenantId, input.connectionId);
    if (!connection) throw new MetaWhatsAppOnboardingError("Meta WhatsApp connection was not found.");
    const owner = { tenantId: input.tenantId, integrationId: connection.integrationId, connectionId: connection.id, provider: "meta_whatsapp" };
    let credential: Awaited<ReturnType<ReturnType<typeof createMetaWhatsAppCredentialVault>["resolve"]>>;
    try {
      credential = await createMetaWhatsAppCredentialVault(this.db, this.bindings).resolve(owner);
    } catch (error) {
      const code = error instanceof MetaWhatsAppCredentialError ? error.code : "META_CREDENTIAL_UNAVAILABLE";
      return {
        connectionId: connection.id,
        ready: false,
        checks: {
          tokenValidity: { status: "failed", code, action: "Reauthorize this connection with Meta, then verify it again." },
          requiredPermissions: { status: "not_checked", code: "not_checked", action: "Resolve a valid credential before checking permissions." },
          expectedWabaAccess: { status: "not_checked", code: "not_checked", action: "Resolve a valid credential before checking WABA access." },
          phoneMembership: { status: "not_checked", code: "not_checked", action: "Resolve a valid credential before checking phone membership." },
          phoneRegistration: { status: "not_checked", code: "not_checked", action: "Resolve a valid credential before checking registration." },
          appSubscription: { status: "not_checked", code: "not_checked", action: "Resolve a valid credential before checking app subscription." },
        },
      };
    }

    let token: MetaTokenInspection;
    try {
      token = await this.provider.inspectToken(credential.accessToken);
    } catch (error) {
      const code = error instanceof MetaWhatsAppOnboardingError ? error.diagnostic.code : "meta_token_debug_failed";
      const unavailable = (action: string): MetaAssetCheck => ({ status: "not_checked", code: "not_checked", action });
      return {
        connectionId: connection.id,
        ready: false,
        checks: {
          tokenValidity: { status: "unavailable", code, action: "Retry verification; Meta token inspection did not complete." },
          requiredPermissions: { status: "not_checked", code: "not_checked", action: "Retry after token inspection completes." },
          expectedWabaAccess: unavailable("Retry after token inspection completes."),
          phoneMembership: unavailable("Retry after token inspection completes."),
          phoneRegistration: unavailable("Retry after token inspection completes."),
          appSubscription: unavailable("Retry after token inspection completes."),
        },
      };
    }

    const tokenUsable = token.valid && token.appIdMatches && (token.expiresAt === undefined || token.expiresAt > Date.now() + 60_000);
    const tokenCheck: MetaAssetCheck = tokenUsable
      ? { status: "passed", code: "token_valid", action: "No action required." }
      : { status: "failed", code: token.appIdMatches ? "meta_token_invalid_or_expired" : "meta_app_id_mismatch", action: "Reauthorize with the configured Meta app and a valid token." };
    const missing = REQUIRED_SCOPES.filter((scope) => !token.scopes.includes(scope));
    const permissionCheck: MetaAssetCheck & { missing?: string[] } = missing.length === 0
      ? { status: "passed", code: "required_permissions_granted", action: "No action required." }
      : { status: "failed", code: "meta_required_scopes_missing", action: "Reauthorize and grant both WhatsApp Business permissions.", missing: [...missing] };
    if (!tokenUsable || missing.length > 0) {
      const action = "Resolve token validity and permission checks before asset verification.";
      const notChecked = (): MetaAssetCheck => ({ status: "not_checked", code: "not_checked", action });
      return {
        connectionId: connection.id,
        ready: false,
        checks: {
          tokenValidity: tokenCheck,
          requiredPermissions: permissionCheck,
          expectedWabaAccess: notChecked(),
          phoneMembership: notChecked(),
          phoneRegistration: notChecked(),
          appSubscription: notChecked(),
        },
      };
    }

    const checks = await Promise.allSettled([
      this.provider.verifyWabaAccess(credential.accessToken, connection.wabaId),
      this.provider.listPhoneNumbers(credential.accessToken, connection.wabaId),
      this.provider.inspectPhoneNumber(credential.accessToken, connection.phoneNumberId),
      this.provider.verifyWebhookSubscription(credential.accessToken, connection.wabaId),
    ]);
    const unavailable = (index: number, fallback: string, action: string): MetaAssetCheck => {
      const result = checks[index];
      const code = result?.status === "rejected" && result.reason instanceof MetaWhatsAppOnboardingError
        ? result.reason.diagnostic.code
        : fallback;
      return { status: "unavailable", code, action };
    };
    const waba = checks[0];
    const phoneList = checks[1];
    const phone = checks[2];
    const subscription = checks[3];
    const wabaCheck: MetaAssetCheck = waba.status === "fulfilled"
      ? waba.value
        ? { status: "passed", code: "expected_waba_access_verified", action: "No action required." }
        : { status: "failed", code: "meta_waba_access_failed", action: "Authorize the expected WABA with this Meta app." }
      : unavailable(0, "meta_waba_access_failed", "Retry verification; Meta could not confirm WABA access.");
    const membershipCheck: MetaAssetCheck = phoneList.status === "fulfilled"
      ? phoneList.value.includes(connection.phoneNumberId)
        ? { status: "passed", code: "phone_membership_verified", action: "No action required." }
        : { status: "failed", code: "meta_phone_membership_failed", action: "Confirm this phone number belongs to the expected WABA." }
      : unavailable(1, "meta_phone_membership_failed", "Retry verification; Meta could not list WABA phone numbers.");
    let registrationCheck: MetaAssetCheck & { providerStatus?: string; platformType?: string; codeVerificationStatus?: string };
    if (phone.status === "rejected") {
      registrationCheck = unavailable(2, "meta_phone_registration_failed", "Retry verification; Meta could not inspect phone registration.");
    } else {
      const registration = phone.value;
      const registered = registration.id === connection.phoneNumberId && registration.status === "CONNECTED" &&
        registration.platformType === "CLOUD_API" && registration.codeVerificationStatus === "VERIFIED";
      registrationCheck = {
        status: registered ? "passed" : "failed",
        code: registered ? "phone_registration_verified" : "meta_phone_registration_failed",
        action: registered ? "No action required." : "Register and verify this phone in Meta, then retry verification.",
        ...(registration.status ? { providerStatus: registration.status } : {}),
        ...(registration.platformType ? { platformType: registration.platformType } : {}),
        ...(registration.codeVerificationStatus ? { codeVerificationStatus: registration.codeVerificationStatus } : {}),
      };
    }
    const subscriptionCheck: MetaAssetCheck = subscription.status === "fulfilled"
      ? subscription.value
        ? { status: "passed", code: "app_subscription_verified", action: "No action required." }
        : { status: "failed", code: "meta_app_subscription_failed", action: "Have an authorized operator subscribe the Meta app to this WABA, then verify again." }
      : unavailable(3, "meta_app_subscription_failed", "Retry verification; Meta could not inspect the app subscription.");
    const finalChecks = {
      tokenValidity: tokenCheck,
      requiredPermissions: permissionCheck,
      expectedWabaAccess: wabaCheck,
      phoneMembership: membershipCheck,
      phoneRegistration: registrationCheck,
      appSubscription: subscriptionCheck,
    };
    return { connectionId: connection.id, ready: Object.values(finalChecks).every((check) => check.status === "passed"), checks: finalChecks };
  }
}

import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { evaluateMetaWhatsAppOperationalAlerts, readMetaWhatsAppOperationalSummary } from "./operational-summary";
import { requirePermission } from "../../../middleware/authorization";
import { requireTenantClientPermission } from "../../../middleware/authorization";
import { IntegrationRepository } from "../../../persistence/repositories/integration-repository";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { MetaWhatsAppOnboardingError, MetaWhatsAppOnboardingService, type MetaDeveloperTestAuthorizationProvider, type MetaWhatsAppOnboardingProvider } from "./onboarding";
import { createMetaWhatsAppGraphOnboardingProvider } from "./graph-onboarding-provider";
import { isMetaWhatsAppDeveloperTestAuthorized } from "./developer-test-config";
import { createMetaWhatsAppCredentialVault, MetaWhatsAppCredentialError } from "./credential-vault";
import {
  META_DIAGNOSTIC_CONNECTION_ID,
  META_DIAGNOSTIC_PHONE_NUMBER_ID,
  META_DIAGNOSTIC_TENANT_ID,
  probeMetaPhoneResource,
} from "./read-only-diagnostic";

export function createMetaWhatsAppRoutes(provider?: MetaWhatsAppOnboardingProvider) {
const routes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
const resolveProvider = (env: AppBindings) => provider ?? createMetaWhatsAppGraphOnboardingProvider(env);

function supportsDeveloperTestAuthorization(
  candidate: MetaWhatsAppOnboardingProvider,
): candidate is MetaWhatsAppOnboardingProvider & MetaDeveloperTestAuthorizationProvider {
  return typeof (candidate as Partial<MetaDeveloperTestAuthorizationProvider>).validateDeveloperTestToken === "function";
}

/** Confirm migration 0042 and 0045 schema exists before exposing review operations.
 * This is deliberately local to the review endpoints; it does not affect webhook routing.
 */
async function hasLegacyReviewSchema(db: AppBindings["DB"]): Promise<boolean> {
  try {
    // LIMIT 0 asks SQLite to validate every referenced table and column without reading rows.
    await db.prepare(`
      SELECT connection.id, connection.tenant_id, connection.integration_id,
        connection.status, connection.activation_state, connection.ghl_location_id,
        connection.ghl_provider_id, integration.provider,
        credential.provider, credential.auth_type, credential.location_id,
        review.connection_id, review.tenant_id,
        review.ghl_location_id, review.ghl_provider_id, review.reviewer_client_id,
        review.evidence_ref, review.reviewed_at, audit.id, audit.tenant_id,
        audit.connection_id, audit.ghl_location_id, audit.actor_client_id,
        audit.previous_state, audit.new_state, audit.reason, audit.trace_id,
        audit.occurred_at
      FROM meta_whatsapp_connections connection
      JOIN integrations integration ON integration.id = connection.integration_id
        AND integration.tenant_id = connection.tenant_id
      LEFT JOIN integration_credentials credential ON credential.tenant_id = connection.tenant_id
      LEFT JOIN meta_whatsapp_legacy_approval_reviews review ON review.connection_id = connection.id
      LEFT JOIN meta_whatsapp_connection_activation_audit audit ON audit.connection_id = connection.id
      LIMIT 0
    `).all();

    const result = await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'trg_meta_whatsapp_activation_audit_immutable_update',
        'trg_meta_whatsapp_activation_audit_immutable_delete',
        'trg_meta_legacy_review_eligibility',
        'trg_meta_legacy_review_immutable_update',
        'trg_meta_legacy_review_immutable_delete'
      )
    `).all<{ name: string }>();
    const required = new Set([
      "trg_meta_whatsapp_activation_audit_immutable_update",
      "trg_meta_whatsapp_activation_audit_immutable_delete",
      "trg_meta_legacy_review_eligibility",
      "trg_meta_legacy_review_immutable_update",
      "trg_meta_legacy_review_immutable_delete",
    ]);
    for (const row of result.results ?? []) required.delete(row.name);
    return required.size === 0;
  } catch {
    // Missing tables, columns, or migration objects are intentionally indistinguishable.
    return false;
  }
}

/**
 * Provision the tenant-owned integration record required by Embedded Signup.
 *
 * Provisioning deliberately does not create credentials or a Meta connection;
 * those are created only after the existing, state-bound onboarding flow has
 * verified the Meta authorization result.
 */
routes.post("/provision", requirePermission("integrations:write"), async (c) => {
  const tenantId = c.get("context").tenant.id;
  const integrations = new IntegrationRepository(c.env.DB);
  const existing = await integrations.findByTenantAndProvider(tenantId, "meta_whatsapp");
  if (existing) {
    return c.json({
      success: true,
      created: false,
      integration: {
        id: existing.id,
        provider: existing.provider,
        enabled: existing.enabled === 1,
        connectionStatus: "unchanged",
      },
    }, 200);
  }

  const integrationId = crypto.randomUUID();
  const created = await integrations.createIfMissing({
    id: integrationId,
    tenant_id: tenantId,
    provider: "meta_whatsapp",
    settings: null,
  });
  const persisted = await integrations.findByTenantAndProvider(tenantId, "meta_whatsapp");
  if (!persisted) {
    return c.json({ success: false, message: "Meta WhatsApp integration could not be provisioned." }, 500);
  }

  return c.json({
    success: true,
    created,
    integration: {
      id: persisted.id,
      provider: persisted.provider,
      enabled: persisted.enabled === 1,
      connectionStatus: "not_connected",
    },
  }, created ? 201 : 200);
});

routes.get("/diagnostics/verify-phone", requirePermission("integrations:test"), async (c) => {
  if (c.env.META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED !== "true") {
    return c.json({ success: false, errorCode: "diagnostic_disabled" }, 404);
  }
  const url = new URL(c.req.url);
  const contentLength = c.req.header("Content-Length");
  if (url.search || (contentLength !== undefined && contentLength !== "0") || c.req.header("Transfer-Encoding")) {
    return c.json({ success: false, errorCode: "diagnostic_request_rejected" }, 400);
  }
  const tenant = c.get("context").tenant;
  if (tenant.id !== META_DIAGNOSTIC_TENANT_ID || tenant.status !== "active") {
    return c.json({ success: false, errorCode: "diagnostic_tenant_rejected" }, 404);
  }
  const connection = await new MetaWhatsAppConnectionRepository(c.env.DB)
    .findByTenantAndId(tenant.id, META_DIAGNOSTIC_CONNECTION_ID)
    .catch(() => null);
  if (!connection || connection.status !== "active" || connection.phoneNumberId !== META_DIAGNOSTIC_PHONE_NUMBER_ID) {
    return c.json({ success: false, errorCode: "diagnostic_connection_rejected" }, 404);
  }
  try {
    const vault = createMetaWhatsAppCredentialVault(c.env.DB, c.env);
    const metadata = await vault.metadata({
      tenantId: tenant.id,
      integrationId: connection.integrationId,
      connectionId: connection.id,
      provider: "meta_whatsapp",
    });
    const scopes = Array.isArray(metadata?.metadata.scopes) ? metadata.metadata.scopes : [];
    if (!metadata || !scopes.includes("whatsapp_business_management") || !scopes.includes("whatsapp_business_messaging")) {
      return c.json({ success: false, errorCode: "diagnostic_credential_unavailable" }, 409);
    }
    const credential = await vault.resolve({
      tenantId: tenant.id,
      integrationId: connection.integrationId,
      connectionId: connection.id,
      provider: "meta_whatsapp",
    });
    const result = await probeMetaPhoneResource({ accessToken: credential.accessToken });
    return c.json(result, 200);
  } catch (error) {
    if (error instanceof MetaWhatsAppCredentialError) {
      return c.json({ success: false, errorCode: "diagnostic_credential_unavailable" }, 409);
    }
    return c.json({ success: false, errorCode: "diagnostic_unavailable" }, 503);
  }
});

routes.post("/onboarding/sessions", requireTenantClientPermission("integrations:oauth:connect"), async (c) => {
  let onboardingProvider: MetaWhatsAppOnboardingProvider; try { onboardingProvider = resolveProvider(c.env); } catch { return c.json({ success: false, message: "Meta WhatsApp onboarding is not configured." }, 503); }
  const principal = c.get("principal");
  const body: { integrationId?: string } = await c.req.json<{ integrationId?: string }>().catch(() => ({}));
  try {
    const result = await new MetaWhatsAppOnboardingService(c.env.DB, c.env, onboardingProvider).start({ tenantId: principal!.tenantId, operatorId: principal!.clientId!, integrationId: body.integrationId?.trim() ?? "" });
    return c.json({ success: true, ...result }, 201);
  } catch (error) { return c.json({ success: false, message: error instanceof MetaWhatsAppOnboardingError ? error.message : "Meta WhatsApp onboarding could not be started." }, 409); }
});

routes.post(
  "/onboarding/developer-test/complete",
  requirePermission("integrations:write"),
  requireTenantClientPermission("integrations:oauth:connect"),
  async (c) => {
    if (new URL(c.req.url).protocol !== "https:") {
      return c.json({ success: false, message: "Meta developer test onboarding requires HTTPS." }, 400);
    }
    let onboardingProvider: MetaWhatsAppOnboardingProvider;
    try {
      onboardingProvider = resolveProvider(c.env);
    } catch {
      return c.json({ success: false, message: "Meta WhatsApp onboarding is not configured." }, 503);
    }
    const principal = c.get("principal");
    const body: {
      state?: string;
      temporaryAccessToken?: string;
      wabaId?: string;
      phoneNumberId?: string;
    } = await c.req.json<{
      state?: string;
      temporaryAccessToken?: string;
      wabaId?: string;
      phoneNumberId?: string;
    }>().catch(() => ({}));
    const wabaId = body.wabaId?.trim() ?? "";
    const phoneNumberId = body.phoneNumberId?.trim() ?? "";
    if (!isMetaWhatsAppDeveloperTestAuthorized(c.env, {
      tenantId: principal!.tenantId,
      wabaId,
      phoneNumberId,
    })) {
      return c.json({ success: false, message: "Meta developer test onboarding is unavailable." }, 404);
    }
    if (!supportsDeveloperTestAuthorization(onboardingProvider)) {
      return c.json({ success: false, message: "Meta developer test onboarding is unavailable." }, 503);
    }
    try {
      const result = await new MetaWhatsAppOnboardingService(c.env.DB, c.env, onboardingProvider).completeDeveloperTest({
        tenantId: principal!.tenantId,
        operatorId: principal!.clientId!,
        state: body.state ?? "",
        accessToken: body.temporaryAccessToken ?? "",
        wabaId,
        phoneNumberId,
      }, onboardingProvider);
      return c.json({ success: true, ...result });
    } catch (error) {
      const diagnostic = error instanceof MetaWhatsAppOnboardingError
        ? error.diagnostic
        : { stage: "unknown" as const, code: "meta_unknown_failure" as const };
      console.error("Meta developer test onboarding failed.", diagnostic);
      return c.json({
        success: false,
        message: error instanceof MetaWhatsAppOnboardingError
          ? error.message
          : "Meta developer test onboarding could not be completed.",
      }, 409);
    }
  },
);

routes.post("/onboarding/complete", requireTenantClientPermission("integrations:oauth:connect"), async (c) => {
  let onboardingProvider: MetaWhatsAppOnboardingProvider; try { onboardingProvider = resolveProvider(c.env); } catch { return c.json({ success: false, message: "Meta WhatsApp onboarding is not configured." }, 503); }
  const principal = c.get("principal"); const body: { state?: string; code?: string; wabaId?: string; phoneNumberId?: string } = await c.req.json<{ state?: string; code?: string; wabaId?: string; phoneNumberId?: string }>().catch(() => ({}));
  try {
    const result = await new MetaWhatsAppOnboardingService(c.env.DB, c.env, onboardingProvider).complete({ tenantId: principal!.tenantId, operatorId: principal!.clientId!, state: body.state ?? "", code: body.code ?? "", wabaId: body.wabaId ?? "", phoneNumberId: body.phoneNumberId ?? "" });
    return c.json({ success: true, ...result });
  } catch (error) { return c.json({ success: false, message: error instanceof MetaWhatsAppOnboardingError ? error.message : "Meta WhatsApp onboarding could not be completed." }, 409); }
});

routes.post("/connections/:connectionId/disable", requireTenantClientPermission("integrations:oauth:connect"), async (c) => {
  let onboardingProvider: MetaWhatsAppOnboardingProvider; try { onboardingProvider = resolveProvider(c.env); } catch { return c.json({ success: false, message: "Meta WhatsApp onboarding is not configured." }, 503); }
  const principal = c.get("principal"); const body: { integrationId?: string; credentialVersion?: number } = await c.req.json<{ integrationId?: string; credentialVersion?: number }>().catch(() => ({}));
  try {
    await new MetaWhatsAppOnboardingService(c.env.DB, c.env, onboardingProvider).disable({ tenantId: principal!.tenantId, integrationId: body.integrationId?.trim() ?? "", connectionId: c.req.param("connectionId"), expectedCredentialVersion: body.credentialVersion ?? 0 });
    return c.json({ success: true, status: "disabled" });
  } catch (error) { return c.json({ success: false, message: error instanceof MetaWhatsAppOnboardingError ? error.message : "Meta WhatsApp connection could not be disabled." }, 409); }
});

routes.get("/operations/summary", requireTenantClientPermission("integrations:test"), async (c) => {
  const summary = await readMetaWhatsAppOperationalSummary(c.env.DB, c.get("principal")!.tenantId);
  const alerts = evaluateMetaWhatsAppOperationalAlerts(summary, {
    enabled: c.env.WABA_OPS_ALERTS_ENABLED,
    backlog: c.env.WABA_OPS_BACKLOG_THRESHOLD,
    failures: c.env.WABA_OPS_FAILURE_THRESHOLD,
    deadLetters: c.env.WABA_OPS_DEAD_LETTER_THRESHOLD,
    credentialExpiry: c.env.WABA_OPS_CREDENTIAL_EXPIRY_THRESHOLD,
    correlationFailures: c.env.WABA_OPS_CORRELATION_FAILURE_THRESHOLD,
  });
  return c.json({ success: true, summary, alerts });
});

routes.get("/connections/legacy-reviews", requireTenantClientPermission("integrations:write"), async (c) => {
  const tenantId = c.get("principal")!.tenantId;
  if (!await hasLegacyReviewSchema(c.env.DB)) return c.json({ success: false, code: "SCHEMA_NOT_READY" }, 503);
  const parsedLimit = Number(c.req.query("limit") ?? 25);
  const parsedOffset = Number(c.req.query("offset") ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100 ||
      !Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 10000) {
    return c.json({ success: false, message: "Invalid pagination." }, 400);
  }
  const result = await c.env.DB.prepare(`
    SELECT audit.connection_id AS connectionId,
      audit.ghl_location_id AS locationId,
      audit.actor_client_id AS reviewerClientId,
      audit.new_state AS decisionState,
      audit.reason AS decisionRecord,
      audit.occurred_at AS reviewedAt
    FROM meta_whatsapp_connection_activation_audit audit
    JOIN meta_whatsapp_connections connection
      ON connection.id = audit.connection_id AND connection.tenant_id = audit.tenant_id
    JOIN integrations integration
      ON integration.id = connection.integration_id
      AND integration.tenant_id = connection.tenant_id
      AND integration.provider = 'meta_whatsapp'
    WHERE audit.tenant_id = ? AND audit.new_state LIKE 'legacy_review_%'
    ORDER BY audit.occurred_at DESC, audit.id DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, parsedLimit, parsedOffset).all<{
    connectionId: string; locationId: string | null; reviewerClientId: string;
    decisionState: string; decisionRecord: string; reviewedAt: string;
  }>();
  const reviews = (result.results ?? []).map((row) => {
    let decision = "unknown";
    let evidenceReference = "unavailable";
    try {
      const record = JSON.parse(row.decisionRecord) as { decision?: unknown; evidenceReference?: unknown };
      if (record.decision === "approve" || record.decision === "reject") decision = record.decision;
      if (typeof record.evidenceReference === "string") evidenceReference = record.evidenceReference;
    } catch { /* malformed historical audit records are returned without their contents */ }
    return {
      connectionId: row.connectionId,
      locationId: row.locationId,
      reviewerClientId: row.reviewerClientId,
      decision,
      decisionState: row.decisionState,
      evidenceReference,
      reviewedAt: row.reviewedAt,
    };
  });
  return c.json({ success: true, reviews, pagination: { limit: parsedLimit, offset: parsedOffset } });
});

routes.post("/connections/legacy-reviews", requireTenantClientPermission("integrations:write"), async (c) => {
  const principal = c.get("principal")!;
  if (!await hasLegacyReviewSchema(c.env.DB)) return c.json({ success: false, code: "SCHEMA_NOT_READY" }, 503);
  const body = await c.req.json<{
    connectionId?: unknown; decision?: unknown; evidenceReference?: unknown; justification?: unknown;
  }>().catch(() => null);
  if (!body || typeof body.connectionId !== "string" || !body.connectionId.trim() ||
      (body.decision !== "approve" && body.decision !== "reject") ||
      typeof body.evidenceReference !== "string" || typeof body.justification !== "string") {
    return c.json({ success: false, message: "A connection, decision, evidence reference, and justification are required." }, 400);
  }
  const evidenceReference = body.evidenceReference.trim();
  const justification = body.justification.trim();
  const approvedEvidence = new Set((c.env.WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!approvedEvidence.has(evidenceReference) || evidenceReference.length > 240 ||
      justification.length < 20 || justification.length > 1000 || /https?:\/\//i.test(evidenceReference)) {
    return c.json({ success: false, message: "Evidence reference is not approved or justification is invalid." }, 400);
  }

  const connection = await c.env.DB.prepare(`
    SELECT c.id, c.tenant_id AS tenantId, c.status, c.activation_state AS activationState,
      c.ghl_location_id AS locationId, c.ghl_provider_id AS providerId
    FROM meta_whatsapp_connections c
    JOIN integrations i ON i.id = c.integration_id AND i.tenant_id = c.tenant_id AND i.provider = 'meta_whatsapp'
    WHERE c.id = ? AND c.tenant_id = ? LIMIT 1
  `).bind(body.connectionId.trim(), principal.tenantId).first<{
    id: string; tenantId: string; status: string; activationState: string;
    locationId: string | null; providerId: string | null;
  }>();
  if (!connection) return c.json({ success: false, message: "Connection review is unavailable." }, 404);
  if (body.decision === "approve" && (connection.status !== "active" ||
      connection.activationState === "suspended" || connection.activationState === "revoked")) {
    return c.json({ success: false, message: "Connection is not eligible for legacy approval." }, 409);
  }
  if (body.decision === "approve" && connection.activationState !== "pending" && connection.activationState !== "legacy_active") {
    return c.json({ success: false, message: "Connection is not in a reviewable lifecycle state." }, 409);
  }
  if (!connection.locationId || !connection.providerId) {
    return c.json({ success: false, message: "Connection ownership metadata is unavailable." }, 409);
  }

  const prior = await c.env.DB.prepare(`
    SELECT new_state AS decision, reason FROM meta_whatsapp_connection_activation_audit
    WHERE tenant_id = ? AND connection_id = ? AND new_state LIKE 'legacy_review_%'
    ORDER BY id ASC
  `).bind(principal.tenantId, connection.id).all<{ decision: string; reason: string }>();
  const decision = body.decision;
  const evidence = evidenceReference;
  const rationale = justification;
  const details = JSON.stringify({ decision, evidenceReference: evidence, justification: rationale });
  const targetState = decision === "approve" ? "legacy_review_approved" : "legacy_review_rejected";
  const priorDecisions = (prior.results ?? []).map((row) => {
    try { return { state: row.decision, ...(JSON.parse(row.reason) as { decision?: string; evidenceReference?: string; justification?: string }) }; }
    catch { return { state: row.decision }; }
  });
  const identical = priorDecisions.find((item) => item.decision === decision && item.evidenceReference === evidence && item.justification === rationale);
  if (identical) return c.json({ success: true, decision, idempotent: true });
  const conflicting = priorDecisions.some((item) => item.state !== targetState && item.state !== "legacy_review_conflict");
  const recordedState = conflicting ? "legacy_review_conflict" : targetState;
  try {
    const statements = [];
    if (decision === "approve" && !conflicting && !priorDecisions.some((item) => item.state === "legacy_review_approved")) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO meta_whatsapp_legacy_approval_reviews
          (connection_id, tenant_id, ghl_location_id, ghl_provider_id, reviewer_client_id, evidence_ref)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(connection.id, principal.tenantId, connection.locationId, connection.providerId, principal.clientId, evidence));
    }
    statements.push(c.env.DB.prepare(`
      INSERT INTO meta_whatsapp_connection_activation_audit
        (tenant_id, connection_id, ghl_location_id, actor_client_id, previous_state, new_state, reason, trace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(principal.tenantId, connection.id, connection.locationId, principal.clientId,
      connection.activationState, recordedState, details, c.req.header("X-Request-ID")?.slice(0, 128) ?? null));
    await c.env.DB.batch(statements);
    return c.json({ success: true, decision, idempotent: false, conflicting });
  } catch {
    return c.json({ success: false, message: "Review could not be recorded; check whether the same approval already exists." }, 409);
  }
});

routes.post("/connections", requirePermission("integrations:write"), async (c) => {
  const tenantId = c.get("context").tenant.id;
  const body = await c.req.json<{ integrationId?: string; wabaId?: string; phoneNumberId?: string }>().catch(() => ({} as { integrationId?: string; wabaId?: string; phoneNumberId?: string }));
  const integrationId = body.integrationId?.trim() ?? "";
  const wabaId = body.wabaId?.trim() ?? "";
  const phoneNumberId = body.phoneNumberId?.trim() ?? "";
  if (!integrationId || !wabaId || !phoneNumberId) return c.json({ success: false, message: "integrationId, wabaId and phoneNumberId are required." }, 400);
  const integration = await new IntegrationRepository(c.env.DB).findByTenantAndProvider(tenantId, "meta_whatsapp");
  if (!integration || integration.id !== integrationId || !integration.enabled) return c.json({ success: false, message: "Meta WhatsApp integration was not found." }, 404);
  const created = await new MetaWhatsAppConnectionRepository(c.env.DB).createPending({ id: crypto.randomUUID(), tenantId, integrationId, wabaId, phoneNumberId });
  if (!created) return c.json({ success: false, message: "The Meta phone number is already assigned." }, 409);
  return c.json({ success: true, status: "pending" }, 201);
});

return routes;
}
export default createMetaWhatsAppRoutes();

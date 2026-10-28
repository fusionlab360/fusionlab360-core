import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../../../config/app";
import { requirePermission } from "../../../middleware/authorization";
import { requireTenantClientPermission } from "../../../middleware/authorization";
import { IntegrationRepository } from "../../../persistence/repositories/integration-repository";
import { MetaWhatsAppConnectionRepository } from "./persistence/connection-repository";
import { MetaWhatsAppOnboardingError, MetaWhatsAppOnboardingService, type MetaWhatsAppOnboardingProvider } from "./onboarding";
import { createMetaWhatsAppGraphOnboardingProvider } from "./graph-onboarding-provider";

export function createMetaWhatsAppRoutes(provider?: MetaWhatsAppOnboardingProvider) {
const routes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
const resolveProvider = (env: AppBindings) => provider ?? createMetaWhatsAppGraphOnboardingProvider(env);

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

routes.post("/onboarding/sessions", requireTenantClientPermission("integrations:oauth:connect"), async (c) => {
  let onboardingProvider: MetaWhatsAppOnboardingProvider; try { onboardingProvider = resolveProvider(c.env); } catch { return c.json({ success: false, message: "Meta WhatsApp onboarding is not configured." }, 503); }
  const principal = c.get("principal");
  const body: { integrationId?: string } = await c.req.json<{ integrationId?: string }>().catch(() => ({}));
  try {
    const result = await new MetaWhatsAppOnboardingService(c.env.DB, c.env, onboardingProvider).start({ tenantId: principal!.tenantId, operatorId: principal!.clientId!, integrationId: body.integrationId?.trim() ?? "" });
    return c.json({ success: true, ...result }, 201);
  } catch (error) { return c.json({ success: false, message: error instanceof MetaWhatsAppOnboardingError ? error.message : "Meta WhatsApp onboarding could not be started." }, 409); }
});

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

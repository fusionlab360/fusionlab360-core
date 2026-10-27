import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  discoverIntegrationController,
  previewIntegrationController,
  configureIntegrationController,
  previewGHLContactEventsController,
  getGHLRentalsBookingPageController,
  updateGHLRentalsBookingPageController,
  getGHLCustomConversationProviderController,
  updateGHLCustomConversationProviderController,
} from "./controller";

import {
  resolveGHLCompanyOAuthToken,
  type GHLCompanyOAuthRuntimeEnvironment,
} from "../../integrations/messaging/gohighlevel/company-oauth-runtime";
import {
  getGHLProviderErrorDiagnostics,
} from "../../integrations/messaging/gohighlevel/oauth";
import {
  publishGHLCustomInboundForTenant,
} from "../../integrations/messaging/gohighlevel/custom-conversation-provider";
import {
  isGHLProviderPilotLocationAuthorized,
} from "../../integrations/messaging/gohighlevel/custom-provider-pilot-config";
import {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";
import {
  IntegrationEventService,
} from "../../core/events/service";
import {
  createIntegrationContext,
} from "../../context/integration";
import {
  searchGHLConversations,
} from "../../integrations/messaging/gohighlevel/conversations";
import {
  ApiError,
} from "../../core/errors/ApiError";


const integrationRoutes =
  new Hono<{
    Bindings:
      AppBindings;
  Variables:
    AppVariables;
  }>();

/**
 * Non-production diagnostics and controlled pilot routes.
 *
 * These route groups are mounted only by development/staging application
 * composition. Production keeps the normal integration and webhook
 * contracts, but does not expose operator diagnostics or synthetic tests.
 */
export const integrationTestRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

export const integrationPilotRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();


integrationRoutes.post(
  "/preview",
  requirePermission("integrations:read"),
  previewIntegrationController,
);


integrationRoutes.post(
  "/discover",
  requirePermission("integrations:read"),
  discoverIntegrationController,
);


integrationRoutes.post(
  "/configure",
  requirePermission("integrations:write"),
  configureIntegrationController,
);

integrationRoutes.get(
  "/gohighlevel/rentals/booking-page",
  requirePermission("integrations:read"),
  getGHLRentalsBookingPageController,
);

integrationRoutes.patch(
  "/gohighlevel/rentals/booking-page",
  requirePermission("integrations:write"),
  updateGHLRentalsBookingPageController,
);

integrationRoutes.get(
  "/gohighlevel/custom-conversation-provider",
  requirePermission("integrations:read"),
  getGHLCustomConversationProviderController,
);

integrationRoutes.patch(
  "/gohighlevel/custom-conversation-provider",
  requirePermission("integrations:write"),
  updateGHLCustomConversationProviderController,
);

/*
 * --------------------------------------------------
 * Pilot-only location OAuth verification
 * --------------------------------------------------
 *
 * This diagnostic deliberately uses the normal tenant-authenticated
 * integration context and the existing location credential runtime. It is
 * limited to the approved pilot tenant/location and never returns provider
 * response data.
 */

const GHL_LOCATION_OAUTH_DIAGNOSTIC_SCOPE = "conversations.readonly";
const GHL_LOCATION_OAUTH_DIAGNOSTIC_TENANT = "gmmetro";
const GHL_LOCATION_OAUTH_DIAGNOSTIC_LOCATION = "Npx2IdDDRjXz2QW3Svx4";

function ghlLocationOAuthDiagnosticErrorCategory(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "upstream_authorization";
    }

    if (error.status === 429) {
      return "upstream_rate_limited";
    }

    if (error.status >= 500) {
      return "upstream_server_error";
    }

    return "upstream_http_error";
  }

  if (error instanceof Error && /oauth|token|credential/i.test(error.message)) {
    return "oauth_runtime_error";
  }

  return "internal_error";
}

integrationTestRoutes.get(
  "/gohighlevel/oauth/verify-location",
  requirePermission("integrations:test"),
  async (c) => {
    const diagnosticResponse = {
      success: false,
      upstreamHttpStatus: null as number | null,
      errorCategory: "pilot_not_authorized",
      requestedScope: GHL_LOCATION_OAUTH_DIAGNOSTIC_SCOPE,
    };
    const requestContext = c.get("context");
    const tenant = requestContext.tenant;
    const locationId = tenant.integrations.crm.credentials.locationId?.trim();

    if (
      tenant.id !== GHL_LOCATION_OAUTH_DIAGNOSTIC_TENANT ||
      tenant.integrations.crm.provider !== "gohighlevel" ||
      locationId !== GHL_LOCATION_OAUTH_DIAGNOSTIC_LOCATION
    ) {
      return c.json(diagnosticResponse, 404);
    }

    try {
      await searchGHLConversations(
        createIntegrationContext(
          tenant,
          "gohighlevel",
          requestContext.integrationRuntime,
        ),
        { limit: 1, page: 1 },
      );

      return c.json({
        success: true,
        upstreamHttpStatus: 200,
        errorCategory: null,
        requestedScope: GHL_LOCATION_OAUTH_DIAGNOSTIC_SCOPE,
      });
    } catch (error) {
      return c.json({
        success: false,
        upstreamHttpStatus: error instanceof ApiError ? error.status : null,
        errorCategory: ghlLocationOAuthDiagnosticErrorCategory(error),
        requestedScope: GHL_LOCATION_OAUTH_DIAGNOSTIC_SCOPE,
      });
    }
  },
);


/*
 * --------------------------------------------------
 * Provider-specific configuration discovery
 * --------------------------------------------------
 *
 * This does not modify generic IPaaS configuration.
 * It exposes GHL Event Object/Field discovery so the
 * caller can supply providerOptions to /configure.
 */

integrationRoutes.post(
  "/gohighlevel/events/preview",
  requirePermission("integrations:read"),
  previewGHLContactEventsController,
);


/*
 * --------------------------------------------------
 * TEMPORARY Company OAuth refresh verification
 * --------------------------------------------------
 *
 * IMPORTANT:
 *
 * This route is intentionally placed under
 * /integrations/* so the existing FusionLab360
 * authentication middleware protects it.
 *
 * It directly exercises:
 *
 *   resolveGHLCompanyOAuthToken()
 *
 * against the existing Company OAuth installation.
 *
 * This is for verification only and should be removed
 * after the Company refresh path has been confirmed.
 *
 * Request body:
 *
 * {
 *   "companyId": "..."
 * }
 */

integrationTestRoutes.post(
  "/gohighlevel/company/refresh-test",
  requirePermission("integrations:test"),

  async (
    c,
  ) => {

    try {

      const body =
        await c.req.json<{
          companyId?:
            string;
        }>();


      const companyId =
        body.companyId?.trim();


      if (
        !companyId
      ) {

        return c.json(
          {
            success:
              false,

            message:
              "companyId is required.",
          },

          400,
        );
      }


      const oauthEnvironment:
        GHLCompanyOAuthRuntimeEnvironment = {

        GHL_OAUTH_CLIENT_ID:
          c.env.GHL_OAUTH_CLIENT_ID,

        GHL_OAUTH_CLIENT_SECRET:
          c.env.GHL_OAUTH_CLIENT_SECRET,

        GHL_OAUTH_REDIRECT_URI:
          c.env.GHL_OAUTH_REDIRECT_URI,
      };


      /*
       * This is the actual Company OAuth runtime
       * refresh path.
       *
       * If the stored Company access token is expired,
       * resolveGHLCompanyOAuthToken() should refresh it,
       * persist the rotated token pair, and return a
       * valid access token.
       */

      await resolveGHLCompanyOAuthToken(
        c.env.DB,

        oauthEnvironment,

        companyId,
      );


      return c.json({

        success:
          true,

        provider:
          "gohighlevel",

        accountType:
          "company",

        companyId,

        message:
          "Company OAuth runtime resolved successfully.",
      });

    } catch (
      error:
        unknown
    ) {

      console.error(
        "GHL Company OAuth refresh test failed.",
        getGHLProviderErrorDiagnostics(error),
      );


      return c.json(
        {
          success:
            false,

          provider:
            "gohighlevel",

          accountType:
            "company",

          message:
            "GHL Company OAuth refresh test failed.",
        },

        500,
      );
    }
  },
);

/*
 * --------------------------------------------------
 * Controlled Custom Conversation Provider test inbound
 * --------------------------------------------------
 *
 * This route is protected by the normal authenticated
 * integrations:test permission and the provider pilot
 * gate. It is intentionally unavailable while the
 * production feature flag is disabled.
 */

integrationPilotRoutes.post(
  "/gohighlevel/custom-conversation-provider/test-inbound",
  requirePermission("integrations:test"),
  async (c) => {
    const requestContext = c.get("context");
    const tenant = requestContext.tenant;
    const locationId = tenant.integrations.crm.credentials.locationId?.trim();

    if (
      tenant.integrations.crm.provider !== "gohighlevel" ||
      !isGHLProviderPilotLocationAuthorized(c.env, locationId)
    ) {
      return c.json({ success: false, message: "Custom provider bridge is disabled for this tenant." }, 404);
    }

    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      return c.json({ success: false, message: "Invalid JSON body." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ success: false, message: "A test contact, message and idempotency key are required." }, 400);
    }

    const input = body as Record<string, unknown>;
    const contactId = typeof input.contactId === "string" ? input.contactId.trim() : "";
    const message = typeof input.message === "string" ? input.message.trim() : "";
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    const occurredAt = typeof input.occurredAt === "string" ? input.occurredAt.trim() : undefined;

    if (
      !contactId || contactId.length > 200 ||
      !message || message.length > 4096 ||
      !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey) ||
      (occurredAt !== undefined && occurredAt.length > 80)
    ) {
      return c.json({ success: false, message: "A valid contactId, message and idempotencyKey are required." }, 400);
    }

    const events = new IntegrationEventService(new IntegrationEventRepository(c.env.DB));
    const accepted = await events.accept({
      eventId: idempotencyKey,
      tenantId: tenant.id,
      eventType: "gohighlevel.custom_provider_test_inbound",
      aggregateType: "conversation_provider_message",
      aggregateId: idempotencyKey,
      provider: "gohighlevel",
      occurredAt: occurredAt || new Date().toISOString(),
      payload: { contactId, message, altId: idempotencyKey },
    });

    if (accepted.duplicate) {
      return c.json({ success: true, accepted: false, duplicate: true });
    }

    const claim = await events.claimForProcessing(tenant.id, accepted.event.eventId);
    if (claim.state !== "claimed") {
      return c.json({ success: false, message: "The test inbound is already being processed." }, 409);
    }

    try {
      await publishGHLCustomInboundForTenant(
        createIntegrationContext(tenant, "gohighlevel", requestContext.integrationRuntime),
        { contactId, message, altId: idempotencyKey, occurredAt },
        c.env,
      );
      await events.markProcessed(tenant.id, accepted.event.eventId, claim.leaseToken);
      return c.json({ success: true, accepted: true, duplicate: false });
    } catch {
      await events.markFailed(tenant.id, accepted.event.eventId, new Error("Custom provider test inbound failed."), claim.leaseToken);
      return c.json({ success: false, message: "The test inbound could not be published." }, 502);
    }
  },
);


export default integrationRoutes;

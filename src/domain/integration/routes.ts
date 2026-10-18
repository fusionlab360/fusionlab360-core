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
} from "./controller";

import {
  resolveGHLCompanyOAuthToken,
  type GHLCompanyOAuthRuntimeEnvironment,
} from "../../integrations/messaging/gohighlevel/company-oauth-runtime";
import {
  getGHLProviderErrorDiagnostics,
} from "../../integrations/messaging/gohighlevel/oauth";


const integrationRoutes =
  new Hono<{
    Bindings:
      AppBindings;
  Variables:
    AppVariables;
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


export const integrationTestRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

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


export default integrationRoutes;

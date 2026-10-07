import type {
  Context,
} from "hono";


import type {
  AppBindings,
  AppVariables,
} from "../../config/app";


import {
  exchangeGHLAuthorizationCode,
} from "../../integrations/messaging/gohighlevel/oauth";


import {
  syncGHLKnownLocationCredentials,
} from "../../integrations/messaging/gohighlevel/credential-sync";


import type {
  GHLCompanyOAuthRuntimeEnvironment,
} from "../../integrations/messaging/gohighlevel/company-oauth-runtime";


import {
  OAuthInstallationRepository,
} from "../../persistence/repositories/oauth-installation-repository";


export async function ghlOAuthCallbackController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  /*
   * --------------------------------------------------
   * 1. Handle OAuth provider error
   * --------------------------------------------------
   */

  const error =
    c.req.query(
      "error",
    );


  if (
    error
  ) {

    const description =
      c.req.query(
        "error_description",
      );


    return c.json(
      {
        success:
          false,

        message:
          description ??
          `HighLevel authorization failed: ${error}`,
      },

      400,
    );
  }


  /*
   * --------------------------------------------------
   * 2. Read authorization code
   * --------------------------------------------------
   */

  const code =
    c.req.query(
      "code",
    );


  if (
    !code
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "Missing HighLevel authorization code.",
      },

      400,
    );
  }


  try {

    /*
     * --------------------------------------------------
     * 3. Build OAuth environment
     * --------------------------------------------------
     */

    const oauthEnvironment:
      GHLCompanyOAuthRuntimeEnvironment = {

      GHL_OAUTH_CLIENT_ID:
        c.env.GHL_OAUTH_CLIENT_ID,

      GHL_OAUTH_CLIENT_SECRET:
        c.env.GHL_OAUTH_CLIENT_SECRET,
    };


    /*
     * --------------------------------------------------
     * 4. Exchange authorization code
     * --------------------------------------------------
     *
     * This returns the initial Company/Agency OAuth
     * access token.
     */

    const token =
      await exchangeGHLAuthorizationCode(
        oauthEnvironment,

        code,
      );


    /*
     * --------------------------------------------------
     * 5. Validate Company ID
     * --------------------------------------------------
     */

    const companyId =
      token.companyId?.trim();


    if (
      !companyId
    ) {

      throw new Error(
        "HighLevel OAuth response did not contain companyId.",
      );
    }


    /*
     * --------------------------------------------------
     * 6. Calculate Company token expiry
     * --------------------------------------------------
     *
     * expires_in is returned in seconds.
     *
     * Store an absolute Unix timestamp in milliseconds.
     */

    const accessTokenExpiresAt =
      typeof token.expires_in ===
      "number"

        ? Date.now() +
          (
            token.expires_in *
            1000
          )

        : null;


    /*
     * --------------------------------------------------
     * 7. Preserve Company OAuth metadata
     * --------------------------------------------------
     */

    const metadata =
      JSON.stringify({
        userType:
          token.userType ??
          "Company",

        scope:
          token.scope ??
          null,

        expiresIn:
          token.expires_in ??
          null,

        isBulkInstallation:
          token.isBulkInstallation ??
          false,

        approvedLocations:
          token.approvedLocations ??
          [],

        installToFutureLocations:
          token.installToFutureLocations ??
          false,

        approveAllLocations:
          token.approveAllLocations ??
          false,
      });


    /*
     * --------------------------------------------------
     * 8. Persist Company OAuth installation
     * --------------------------------------------------
     */

    const repository =
      new OAuthInstallationRepository(
        c.env.DB,
      );


    await repository.upsert({

      provider:
        "gohighlevel",

      accountType:
        "company",

      externalAccountId:
        companyId,

      externalUserId:
        token.userId ??
        null,

      accessToken:
        token.access_token,

      refreshToken:
        token.refresh_token ??
        null,

      accessTokenExpiresAt,

      refreshLockToken:
        null,

      refreshLockExpiresAt:
        null,

      metadata,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    });


    /*
     * --------------------------------------------------
     * 9. Refresh existing Location credentials
     * --------------------------------------------------
     *
     * The newly authorized Company token becomes the
     * source for all already-connected FusionLab360
     * GHL locations belonging to this company.
     *
     * syncGHLKnownLocationCredentials() will resolve
     * the Company token through the Company OAuth runtime,
     * then exchange it for fresh Location tokens.
     */

    const locationCredentialSync =
      await syncGHLKnownLocationCredentials(
        c.env.DB,

        oauthEnvironment,

        companyId,

        {
          appId:
            undefined,

          versionId:
            undefined,

          planId:
            undefined,

          userId:
            token.userId,
        },
      );


    /*
     * --------------------------------------------------
     * 10. Return success
     * --------------------------------------------------
     */

    return c.json({

      success:
        true,

      provider:
        "gohighlevel",

      accountType:
        "company",

      companyId,

      userId:
        token.userId ??
        null,

      locationsFound:
        locationCredentialSync.locationsFound,

      locationResults:
        locationCredentialSync.results,

      message:
        "HighLevel authorization completed successfully. " +
        "Existing FusionLab360 GHL locations were refreshed " +
        "from the new company authorization.",
    });

  } catch (
    error: unknown
  ) {

    console.error(
      "HighLevel OAuth callback failed.",

      error,
    );


    return c.json(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : "HighLevel OAuth callback failed.",
      },

      500,
    );
  }
}
import {
  CredentialRepository,
} from "../../../persistence/repositories/credential-repository";

import {
  exchangeGHLCompanyTokenForLocationToken,
} from "./oauth";

import {
  resolveGHLCompanyOAuthToken,
  type GHLCompanyOAuthRuntimeEnvironment,
} from "./company-oauth-runtime";


export async function syncGHLLocationCredential(
  db:
    D1Database,

  env:
    GHLCompanyOAuthRuntimeEnvironment,

  companyId:
    string,

  locationId:
    string,

  payloadMetadata?: {
    appId?: string;
    versionId?: string;
    planId?: string;
    userId?: string;
  },
): Promise<{
  tenantId: string;

  companyId: string;

  locationId: string;

  scope:
    string | null;

  versionId:
    string | null;

  expiresIn:
    number | null;
}> {

  const normalizedCompanyId =
    companyId.trim();

  const normalizedLocationId =
    locationId.trim();


  if (
    !normalizedCompanyId
  ) {

    throw new Error(
      "GHL companyId is required.",
    );
  }


  if (
    !normalizedLocationId
  ) {

    throw new Error(
      "GHL locationId is required.",
    );
  }


  /*
   * --------------------------------------------------
   * 1. Resolve the existing FusionLab360 tenant
   * --------------------------------------------------
   */

  const credentialRepository =
    new CredentialRepository(
      db,
    );


  const tenantId =
    await credentialRepository
      .findTenantIdByProviderAndLocation(
        "gohighlevel",

        normalizedLocationId,
      );


  if (
    !tenantId
  ) {

    throw new Error(
      `No FusionLab360 tenant mapping found for GHL location=${normalizedLocationId}.`,
    );
  }


  /*
   * --------------------------------------------------
   * 2. Resolve the Company OAuth access token
   * --------------------------------------------------
   *
   * The company token is managed by the dedicated
   * Company OAuth runtime. It handles:
   *
   * - expiry detection
   * - refresh token rotation
   * - refresh locking
   * - persistence
   */

  const companyAccessToken =
    await resolveGHLCompanyOAuthToken(
      db,

      env,

      normalizedCompanyId,
    );


  /*
   * --------------------------------------------------
   * 3. Mint a fresh Location token
   * --------------------------------------------------
   */

  const locationToken =
    await exchangeGHLCompanyTokenForLocationToken(
      companyAccessToken,

      normalizedCompanyId,

      normalizedLocationId,
    );


  /*
   * --------------------------------------------------
   * 4. Calculate token expiry
   * --------------------------------------------------
   *
   * expires_in is expressed in seconds.
   *
   * Persist an absolute Unix timestamp in milliseconds
   * so the runtime can determine whether the token
   * requires refresh without depending on metadata.
   */

  const accessTokenExpiresAt =
    typeof locationToken.expires_in ===
    "number"

      ? Date.now() +
        (
          locationToken.expires_in *
          1000
        )

      : null;


  /*
   * --------------------------------------------------
   * 5. Preserve provider metadata
   * --------------------------------------------------
   */

  const metadata =
    JSON.stringify({
      accountType:
        "location",

      companyId:
        normalizedCompanyId,

      locationId:
        normalizedLocationId,

      userId:
        locationToken.userId ??
        payloadMetadata?.userId ??
        null,

      scope:
        locationToken.scope ??
        null,

      expiresIn:
        locationToken.expires_in ??
        null,

      appId:
        locationToken.appId ??
        payloadMetadata?.appId ??
        null,

      versionId:
        locationToken.versionId ??
        payloadMetadata?.versionId ??
        null,

      planId:
        locationToken.planId ??
        payloadMetadata?.planId ??
        null,
    });


  /*
   * --------------------------------------------------
   * 6. Update the existing OAuth credential
   * --------------------------------------------------
   *
   * CredentialRepository protects an existing PIT
   * credential from being overwritten.
   */

  await credentialRepository
    .upsertOAuthCredential(
      tenantId,

      "gohighlevel",

      normalizedLocationId,

      locationToken.access_token,

      locationToken.refresh_token ??
        null,

      metadata,

      accessTokenExpiresAt,
    );


  return {
    tenantId,

    companyId:
      normalizedCompanyId,

    locationId:
      normalizedLocationId,

    scope:
      locationToken.scope ??
      null,

    versionId:
      locationToken.versionId ??
      null,

    expiresIn:
      locationToken.expires_in ??
      null,
  };
}


/**
 * Refresh all known FusionLab360 GHL locations
 * belonging to a company.
 *
 * The Company OAuth token is resolved through the
 * dedicated Company OAuth runtime for every location.
 */
export async function syncGHLKnownLocationCredentials(
  db:
    D1Database,

  env:
    GHLCompanyOAuthRuntimeEnvironment,

  companyId:
    string,

  payloadMetadata?: {
    appId?: string;
    versionId?: string;
    planId?: string;
    userId?: string;
  },
) {

  const normalizedCompanyId =
    companyId.trim();


  if (
    !normalizedCompanyId
  ) {

    throw new Error(
      "GHL companyId is required.",
    );
  }


  const credentialRepository =
    new CredentialRepository(
      db,
    );


  const locations =
    await credentialRepository
      .findLocationsByProviderAndCompany(
        "gohighlevel",

        normalizedCompanyId,
      );


  const results:
    Array<{
      locationId:
        string;

      success:
        boolean;

      error?:
        string;
    }> = [];


  for (
    const location of locations
  ) {

    try {

      await syncGHLLocationCredential(
        db,

        env,

        normalizedCompanyId,

        location.locationId,

        payloadMetadata,
      );


      results.push({
        locationId:
          location.locationId,

        success:
          true,
      });

    } catch (
      error: unknown
    ) {

      console.error(
        "GHL location credential refresh failed.",

        {
          companyId:
            normalizedCompanyId,

          locationId:
            location.locationId,

          error:
            error instanceof Error
              ? error.message
              : error,
        },
      );


      results.push({
        locationId:
          location.locationId,

        success:
          false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }


  return {
    companyId:
      normalizedCompanyId,

    locationsFound:
      locations.length,

    results,
  };
}
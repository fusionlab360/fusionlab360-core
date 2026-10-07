import {
  OAuthInstallationRepository,
} from "../../../persistence/repositories/oauth-installation-repository";

import {
  CredentialRepository,
} from "../../../persistence/repositories/credential-repository";

import {
  exchangeGHLCompanyTokenForLocationToken,
} from "./oauth";


export async function syncGHLLocationCredential(
  db: D1Database,
  companyId: string,
  locationId: string,
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


  if (!normalizedCompanyId) {
    throw new Error(
      "GHL companyId is required.",
    );
  }


  if (!normalizedLocationId) {
    throw new Error(
      "GHL locationId is required.",
    );
  }


  /*
   * --------------------------------------------------
   * 1. Resolve the existing Company OAuth installation
   * --------------------------------------------------
   */

  const oauthRepository =
    new OAuthInstallationRepository(
      db,
    );


  const companyInstallation =
    await oauthRepository.find(
      "gohighlevel",
      "company",
      normalizedCompanyId,
    );


  if (!companyInstallation) {
    throw new Error(
      `No GHL company OAuth installation found for company=${normalizedCompanyId}.`,
    );
  }


  /*
   * --------------------------------------------------
   * 2. Resolve the existing FusionLab360 tenant
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


  if (!tenantId) {
    throw new Error(
      `No FusionLab360 tenant mapping found for GHL location=${normalizedLocationId}.`,
    );
  }


  /*
   * --------------------------------------------------
   * 3. Mint a fresh Location token
   * --------------------------------------------------
   */

  const locationToken =
    await exchangeGHLCompanyTokenForLocationToken(
      companyInstallation.accessToken,
      normalizedCompanyId,
      normalizedLocationId,
    );


  /*
   * --------------------------------------------------
   * 4. Preserve the provider metadata
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
   * 5. Update the EXISTING credential row
   * --------------------------------------------------
   *
   * No second credential.
   *
   * tenant + provider remains:
   *
   * gmmoments + gohighlevel
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

export async function syncGHLKnownLocationCredentials(
  db: D1Database,
  companyId: string,
  payloadMetadata?: {
    appId?: string;
    versionId?: string;
    planId?: string;
    userId?: string;
  },
) {
  const credentialRepository =
    new CredentialRepository(
      db,
    );

  const locations =
    await credentialRepository
      .findLocationsByProviderAndCompany(
        "gohighlevel",
        companyId,
      );

  const results: Array<{
    locationId: string;
    success: boolean;
    error?: string;
  }> = [];

  for (
    const location of locations
  ) {
    try {
      await syncGHLLocationCredential(
        db,
        companyId,
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
          companyId,
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
    companyId,
    locationsFound:
      locations.length,
    results,
  };
}
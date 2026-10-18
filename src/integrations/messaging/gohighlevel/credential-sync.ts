import {
  CredentialRepository,
} from "../../../persistence/repositories/credential-repository";

import {
  IntegrationRepository,
} from "../../../persistence/repositories/integration-repository";

import {
  TenantRepository,
} from "../../../persistence/repositories/tenant-repository";

import {
  exchangeGHLCompanyTokenForLocationToken,
  getGHLProviderErrorDiagnostics,
} from "./oauth";

import {
  resolveGHLCompanyOAuthToken,
  type GHLCompanyOAuthRuntimeEnvironment,
} from "./company-oauth-runtime";

/** Complete the local activation steps after a location token is persisted. */
export async function completePendingGHLLocationOnboarding(
  db: D1Database,
  tenantId: string,
  companyId: string,
  locationId: string,
): Promise<void> {
  const credentialRepository = new CredentialRepository(db);
  const integrationRepository = new IntegrationRepository(db);
  const tenantRepository = new TenantRepository(db);

  await credentialRepository.assertLocationOwnership(tenantId, "gohighlevel", locationId);

  const credentialConnected =
    await credentialRepository.markPendingOAuthCredentialConnected(
      tenantId,
      "gohighlevel",
      locationId,
      companyId,
    );

  if (!credentialConnected) {
    throw new Error("The matching OAuth credential could not be finalized.");
  }

  const integrationEnabled =
    await integrationRepository.enablePendingOAuthIntegration(
      tenantId,
      "gohighlevel",
      locationId,
      companyId,
    );

  if (!integrationEnabled) {
    throw new Error("The matching OAuth integration could not be enabled.");
  }

  const tenantActivated =
    await tenantRepository.activatePendingOAuthTenant(
      tenantId,
      "gohighlevel",
      locationId,
      companyId,
    );

  if (!tenantActivated) {
    throw new Error("The matching OAuth tenant could not be activated.");
  }
}

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
  options?: {
    expectedTenantId?: string;
    companyAccessToken?: string;
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

  success: boolean;

  credentialSyncStatus:
    | "stored"
    | "skipped_legacy_pit";

  error?: "legacy_pit_preserved";
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

  if (
    options?.expectedTenantId &&
    tenantId !== options.expectedTenantId
  ) {
    throw new Error(
      "The OAuth Location no longer maps to the tenant that initiated authorization.",
    );
  }


  const existingCredential =
    await credentialRepository.findByTenantAndProvider(
      tenantId,
      "gohighlevel",
    );

    let existingMetadata: Record<string, unknown> | null = null;

  try {
    existingMetadata = existingCredential?.metadata
      ? JSON.parse(existingCredential.metadata)
      : null;
  } catch {
    existingMetadata = null;
  }

  const isPendingOAuth =
    existingCredential?.authType === "oauth2" &&
    existingMetadata?.connectionStatus === "pending_oauth";

  if (isPendingOAuth) {
    const pendingCompanyId = existingMetadata?.companyId;
    const pendingLocationId = existingMetadata?.locationId;

    if (
      pendingCompanyId !== normalizedCompanyId ||
      pendingLocationId !== normalizedLocationId
    ) {
      throw new Error(
        "OAuth callback does not match the pending tenant Company ID and Location ID.",
      );
    }
  }

  if (existingCredential?.authType === "api_key") {
    return {
      tenantId,
      companyId: normalizedCompanyId,
      locationId: normalizedLocationId,
      scope: null,
      versionId: null,
      expiresIn: null,
      success: false,
      credentialSyncStatus: "skipped_legacy_pit",
      error: "legacy_pit_preserved",
    };
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

  const suppliedCompanyAccessToken =
    options?.companyAccessToken?.trim();

  if (
    options?.companyAccessToken !== undefined &&
    !suppliedCompanyAccessToken
  ) {
    throw new Error("HighLevel Company access token is required.");
  }

  const companyAccessToken = suppliedCompanyAccessToken ??
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

      connectionStatus:
        isPendingOAuth
          ? "pending_oauth"
          : "connected",
    });


  /*
   * --------------------------------------------------
   * 6. Update the existing OAuth credential
   * --------------------------------------------------
   *
   * CredentialRepository protects an existing PIT
   * credential from being overwritten.
   */

    const credentialWrite =
    await credentialRepository.upsertOAuthCredential(
      tenantId,
      "gohighlevel",
      normalizedLocationId,
      locationToken.access_token,
      locationToken.refresh_token ?? null,
      metadata,
      accessTokenExpiresAt,
    );

  if (credentialWrite.status === "skipped_legacy_pit") {
    return {
      tenantId,
      companyId: normalizedCompanyId,
      locationId: normalizedLocationId,
      scope: null,
      versionId: null,
      expiresIn: null,
      success: false,
      credentialSyncStatus: "skipped_legacy_pit",
      error: "legacy_pit_preserved",
    };
  }

    if (isPendingOAuth) {
    await completePendingGHLLocationOnboarding(
      db,
      tenantId,
      normalizedCompanyId,
      normalizedLocationId,
    );
  }

  return {
    tenantId,
    companyId: normalizedCompanyId,
    locationId: normalizedLocationId,
    scope: locationToken.scope ?? null,
    versionId:
      locationToken.versionId ??
      payloadMetadata?.versionId ??
      null,
    expiresIn:
      typeof locationToken.expires_in === "number"
        ? locationToken.expires_in
        : null,
    success: true,
    credentialSyncStatus: "stored",
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


    const results: Array<{
    locationId: string;
    success: boolean;
    status:
      | "stored"
      | "skipped_legacy_pit"
      | "failed";
    error?: string;
  }> = [];


  for (
    const location of locations
  ) {

        try {
      const syncResult = await syncGHLLocationCredential(
        db,
        env,
        normalizedCompanyId,
        location.locationId,
        payloadMetadata,
      );

      results.push({
        locationId: location.locationId,
        success: syncResult.success,
        status:
          syncResult.credentialSyncStatus === "stored"
            ? "stored"
            : "skipped_legacy_pit",
        ...(syncResult.error
          ? { error: syncResult.error }
          : {}),
      });
    } catch (error: unknown) {
      console.error(
        "GHL location credential refresh failed.",
        {
          companyId: normalizedCompanyId,
          locationId: location.locationId,
          ...getGHLProviderErrorDiagnostics(error),
        },
      );

      results.push({
        locationId: location.locationId,
        success: false,
        status: "failed",
        error:
          getGHLProviderErrorDiagnostics(error).classification,
      });
    }
  }


    const status =
    locations.length === 0
      ? "no_locations"
      : results.every((result) => result.success)
        ? "complete"
        : "incomplete";

    return {
      companyId: normalizedCompanyId,
      locationsFound: locations.length,
      success: status === "complete",
      status,
      results,
    };
}

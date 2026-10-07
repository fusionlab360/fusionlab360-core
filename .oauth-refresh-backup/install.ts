import {
  syncGHLLocationCredential,
  syncGHLKnownLocationCredentials,
} from "./credential-sync";


export interface GHLInstallWebhookPayload {

  type:
    string;

  appId?:
    string;

  versionId?:
    string;

  previousVersionId?:
    string;

  installType?:
    string;

  locationId?:
    string;

  companyId?:
    string;

  userId?:
    string;

  planId?:
    string;

  companyName?:
    string;

  timestamp?:
    string;

  webhookId?:
    string;

  isWhitelabelCompany?:
    boolean;

  whitelabelDetails?:
    unknown;

  trial?:
    unknown;
}


/**
 * Process a GHL INSTALL webhook.
 *
 * A locationId is normally available for a location
 * installation. However, HighLevel may also deliver
 * an installation event without a locationId.
 *
 * In that case, do not call the location-token
 * exchange with an empty locationId.
 *
 * The OAuth callback already refreshes known
 * FusionLab360 GHL locations from the newly
 * authorized company installation.
 */
export async function processGHLInstall(
  db:
    D1Database,

  payload:
    GHLInstallWebhookPayload,
) {

  if (
    payload.type !==
    "INSTALL"
  ) {
    throw new Error(
      `Unsupported GHL installation event: ${payload.type}`,
    );
  }


  const companyId =
    payload.companyId?.trim();


  if (!companyId) {
    throw new Error(
      "GHL INSTALL event is missing companyId.",
    );
  }


  const locationId =
    payload.locationId?.trim();


  /*
   * --------------------------------------------------
   * Company-level INSTALL
   * --------------------------------------------------
   *
   * Do not attempt a location-token exchange when
   * HighLevel does not provide a locationId.
   *
   * The OAuth callback handles refreshing all
   * already-connected FusionLab360 locations.
   */

  if (!locationId) {

    console.warn(
      "GHL INSTALL event has no locationId. " +
      "Skipping location credential synchronization.",
      {
        companyId,
      },
    );


    return {
      mode:
        "company_only" as const,

      companyId,

      locationId:
        null,

      synchronized:
        false,
    };
  }


  /*
   * --------------------------------------------------
   * Location-level INSTALL
   * --------------------------------------------------
   *
   * Exchange the company authorization for the
   * location-specific access token and persist it
   * against the existing tenant/provider credential.
   */

  return syncGHLLocationCredential(
    db,

    companyId,

    locationId,

    {
      appId:
        payload.appId,

      versionId:
        payload.versionId,

      planId:
        payload.planId,

      userId:
        payload.userId,
    },
  );
}


/**
 * Process a GHL APP UPDATE webhook.
 *
 * There are two cases:
 *
 * 1. HighLevel supplies locationId:
 *    refresh only that location.
 *
 * 2. HighLevel does not supply locationId:
 *    refresh every already-connected location
 *    belonging to this company.
 */
export async function processGHLAppUpdate(
  db:
    D1Database,

  payload:
    GHLInstallWebhookPayload,
) {

  if (
    payload.type !==
    "UPDATE"
  ) {
    throw new Error(
      `Unsupported GHL app update event: ${payload.type}`,
    );
  }


  const companyId =
    payload.companyId?.trim();


  if (!companyId) {
    throw new Error(
      "GHL companyId is required.",
    );
  }


  const locationId =
    payload.locationId?.trim();


  /*
   * --------------------------------------------------
   * Location-level UPDATE
   * --------------------------------------------------
   */

  if (locationId) {

    return syncGHLLocationCredential(
      db,

      companyId,

      locationId,

      {
        appId:
          payload.appId,

        versionId:
          payload.versionId,

        planId:
          payload.planId,

        userId:
          payload.userId,
      },
    );
  }


  /*
   * --------------------------------------------------
   * Company/Agency-level UPDATE
   * --------------------------------------------------
   *
   * HighLevel may omit locationId when the application
   * itself is updated.
   *
   * Refresh every already-connected location belonging
   * to this GHL company.
   */

  return syncGHLKnownLocationCredentials(
    db,

    companyId,

    {
      appId:
        payload.appId,

      versionId:
        payload.versionId,

      planId:
        payload.planId,

      userId:
        payload.userId,
    },
  );
}
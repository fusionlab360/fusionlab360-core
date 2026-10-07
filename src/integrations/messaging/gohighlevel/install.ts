import {
  syncGHLLocationCredential,
  syncGHLKnownLocationCredentials,
} from "./credential-sync";

import type {
  GHLCompanyOAuthRuntimeEnvironment,
} from "./company-oauth-runtime";


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
 * The Company OAuth token is resolved through the
 * dedicated Company OAuth runtime.
 */
export async function processGHLInstall(
  db:
    D1Database,

  env:
    GHLCompanyOAuthRuntimeEnvironment,

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


  if (
    !companyId
  ) {

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
   * The Company OAuth installation is retained
   * independently and the location synchronization
   * can occur when a location is known.
   */

  if (
    !locationId
  ) {

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
   * Resolve the current Company OAuth token through
   * the Company OAuth runtime, then exchange it for
   * the Location token.
   */

  return syncGHLLocationCredential(
    db,

    env,

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
 *
 * The Company OAuth token is resolved through
 * the dedicated Company OAuth runtime.
 */
export async function processGHLAppUpdate(
  db:
    D1Database,

  env:
    GHLCompanyOAuthRuntimeEnvironment,

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


  if (
    !companyId
  ) {

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

  if (
    locationId
  ) {

    return syncGHLLocationCredential(
      db,

      env,

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

    env,

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
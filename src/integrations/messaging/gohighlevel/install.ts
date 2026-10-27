import {
  syncGHLLocationCredential,
  syncGHLKnownLocationCredentials,
} from "./credential-sync";

import type {
  GHLCompanyOAuthRuntimeEnvironment,
} from "./company-oauth-runtime";

import {
  CredentialRepository,
} from "../../../persistence/repositories/credential-repository";

import {
  IntegrationRepository,
} from "../../../persistence/repositories/integration-repository";


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

export function isGHLUninstallEvent(
  type: string | undefined,
): boolean {
  const normalized = type?.trim().toUpperCase().replace(/[-\s]+/g, "_");
  return normalized === "UNINSTALL" || normalized === "APP_UNINSTALL";
}

/**
 * Process a signed GHL uninstall lifecycle event.
 *
 * Location-less agency events are acknowledged by the caller but are not
 * allowed to disable every location belonging to a shared installation.
 */
export async function processGHLUninstall(
  db: D1Database,
  payload: GHLInstallWebhookPayload,
): Promise<{
  status: "disconnected" | "ignored";
  reason?: "missing_location" | "unknown_location" | "credential_mismatch" | "company_mismatch";
  tenantId?: string;
  locationId?: string;
  credentialChanged: boolean;
  integrationChanged: boolean;
}> {
  if (!isGHLUninstallEvent(payload.type)) {
    throw new Error(`Unsupported GHL uninstall event: ${payload.type}`);
  }

  const locationId = payload.locationId?.trim();
  if (!locationId) {
    return {
      status: "ignored",
      reason: "missing_location",
      credentialChanged: false,
      integrationChanged: false,
    };
  }

  const credentials = new CredentialRepository(db);
  const tenantId = await credentials.findTenantIdByProviderAndLocation(
    "gohighlevel",
    locationId,
  );
  if (!tenantId) {
    return {
      status: "ignored",
      reason: "unknown_location",
      locationId,
      credentialChanged: false,
      integrationChanged: false,
    };
  }

  const credential = await credentials.findByTenantAndProvider(
    tenantId,
    "gohighlevel",
  );
  const companyId = payload.companyId?.trim();
  let metadata: Record<string, unknown> = {};
  try {
    metadata = credential?.metadata ? JSON.parse(credential.metadata) as Record<string, unknown> : {};
  } catch {
    metadata = {};
  }

  if (
    !credential ||
    credential.authType !== "oauth2" ||
    credential.locationId.trim() !== locationId
  ) {
    return {
      status: "ignored",
      reason: "credential_mismatch",
      tenantId,
      locationId,
      credentialChanged: false,
      integrationChanged: false,
    };
  }

  if (
    companyId &&
    metadata.companyId !== companyId
  ) {
    return {
      status: "ignored",
      reason: "company_mismatch",
      tenantId,
      locationId,
      credentialChanged: false,
      integrationChanged: false,
    };
  }

  const credentialChanged = await credentials.markGHLUninstalled(
    tenantId,
    locationId,
    companyId,
  );
  const integrationChanged = await new IntegrationRepository(db).disableGHLLocation(
    tenantId,
    locationId,
    companyId,
  );

  return {
    status: "disconnected",
    tenantId,
    locationId,
    credentialChanged,
    integrationChanged,
  };
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

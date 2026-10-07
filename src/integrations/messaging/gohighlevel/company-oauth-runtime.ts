import {
  OAuthInstallationRepository,
} from "../../../persistence/repositories/oauth-installation-repository";

import type {
  OAuthInstallation,
} from "../../../persistence/models/oauth-installation";

import {
  isGHLInvalidGrantError,
  reconnectGHLCompanyAccessToken,
  refreshGHLCompanyAccessToken,
} from "./oauth";


export interface GHLCompanyOAuthRuntimeEnvironment {

  GHL_OAUTH_CLIENT_ID:
    string;

  GHL_OAUTH_CLIENT_SECRET:
    string;
}


const REFRESH_SKEW_MS =
  5 * 60 * 1000;


const REFRESH_LOCK_DURATION_MS =
  30 * 1000;


const REFRESH_WAIT_ATTEMPTS =
  4;


const REFRESH_WAIT_MS =
  250;


function sleep(
  milliseconds:
    number,
): Promise<void> {

  return new Promise(
    (
      resolve,
    ) =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}


/*
 * --------------------------------------------------
 * Token normalization
 * --------------------------------------------------
 */

function normalizeToken(
  value:
    unknown,
): string {

  return typeof value ===
    "string"

    ? value.trim()

    : "";
}


/*
 * --------------------------------------------------
 * Credential expiry
 * --------------------------------------------------
 */

function needsRefresh(
  installation:
    OAuthInstallation,
): boolean {

  /*
   * No expiry means we cannot prove that the token
   * is valid. Treat it as requiring refresh.
   */

  if (
    installation.accessTokenExpiresAt ===
    null ||

    installation.accessTokenExpiresAt ===
    undefined
  ) {

    return true;
  }


  return (
    installation.accessTokenExpiresAt -
      Date.now()
    <=
    REFRESH_SKEW_MS
  );
}


/*
 * --------------------------------------------------
 * Refresh metadata
 * --------------------------------------------------
 */

function buildRefreshMetadata(
  existingMetadata:
    string | null | undefined,

  expiresIn:
    number | undefined,
): string | null {

  let metadata:
    Record<
      string,
      unknown
    > = {};


  if (
    typeof existingMetadata ===
    "string"
  ) {

    try {

      const parsed =
        JSON.parse(
          existingMetadata,
        );


      if (
        typeof parsed ===
        "object" &&

        parsed !==
        null &&

        !Array.isArray(
          parsed,
        )
      ) {

        metadata =
          parsed as Record<
            string,
            unknown
          >;
      }

    } catch {

      /*
       * Invalid legacy metadata must not prevent
       * OAuth refresh or recovery.
       */

      metadata = {};
    }
  }


  if (
    typeof expiresIn ===
    "number"
  ) {

    metadata.expiresIn =
      expiresIn;
  }


  metadata.lastTokenRefreshAt =
    new Date().toISOString();


  /*
   * Successful refresh/reconnect means the OAuth
   * lifecycle is currently healthy.
   */

  metadata.oauthRecoveryStatus =
    "active";


  metadata.oauthRecoveryLastSuccessAt =
    new Date().toISOString();


  /*
   * Remove stale failure state after a successful
   * refresh/reconnect.
   */

  delete metadata.oauthRecoveryLastFailureAt;

  delete metadata.oauthRecoveryError;


  return JSON.stringify(
    metadata,
  );
}


/*
 * --------------------------------------------------
 * GHL Company OAuth runtime
 * --------------------------------------------------
 */

export async function resolveGHLCompanyOAuthToken(
  db:
    D1Database,

  env:
    GHLCompanyOAuthRuntimeEnvironment,

  companyId:
    string,

  options?: {
    forceRefresh?:
      boolean;
  },
): Promise<string> {

  const normalizedCompanyId =
    companyId.trim();


  if (
    !normalizedCompanyId
  ) {

    throw new Error(
      "GHL companyId is required.",
    );
  }


  const repository =
    new OAuthInstallationRepository(
      db,
    );


  /*
   * ------------------------------------------------
   * 1. Load Company OAuth installation
   * ------------------------------------------------
   */

  let installation =
    await repository.find(
      "gohighlevel",

      "company",

      normalizedCompanyId,
    );


  if (
    !installation
  ) {

    throw new Error(
      `No GHL company OAuth installation found for company=${normalizedCompanyId}.`,
    );
  }


  /*
   * ------------------------------------------------
   * 2. Existing token is still valid
   * ------------------------------------------------
   */

  const currentAccessToken =
    normalizeToken(
      installation.accessToken,
    );


  if (
    !options?.forceRefresh &&

    currentAccessToken &&

    !needsRefresh(
      installation,
    )
  ) {

    return currentAccessToken;
  }


  /*
   * ------------------------------------------------
   * 3. Acquire refresh/recovery lease
   * ------------------------------------------------
   */

  const lockToken =
    crypto.randomUUID();


  const now =
    Date.now();


  const lockExpiresAt =
    now +
    REFRESH_LOCK_DURATION_MS;


  const lockAcquired =
    await repository
      .acquireRefreshLock(
        "gohighlevel",

        "company",

        normalizedCompanyId,

        lockToken,

        now,

        lockExpiresAt,
      );


  /*
   * ------------------------------------------------
   * 4. Another Worker owns the lease
   * ------------------------------------------------
   */

  if (
    !lockAcquired
  ) {

    for (
      let attempt = 0;

      attempt <
      REFRESH_WAIT_ATTEMPTS;

      attempt++
    ) {

      await sleep(
        REFRESH_WAIT_MS,
      );


      installation =
        await repository.find(
          "gohighlevel",

          "company",

          normalizedCompanyId,
        );


      if (
        !installation
      ) {

        throw new Error(
          `GHL company OAuth installation disappeared while waiting for refresh for company=${normalizedCompanyId}.`,
        );
      }


      const latestAccessToken =
        normalizeToken(
          installation.accessToken,
        );


      /*
       * Another worker successfully refreshed/reconnected
       * the token.
       */

      if (
        latestAccessToken &&

        !needsRefresh(
          installation,
        )
      ) {

        return latestAccessToken;
      }
    }


    throw new Error(
      `GHL company OAuth token refresh/recovery is already in progress for company=${normalizedCompanyId}.`,
    );
  }


  /*
   * ------------------------------------------------
   * 5. We own the refresh/recovery lease
   * ------------------------------------------------
   */

  try {

    /*
     * Reload after acquiring the lease.
     *
     * Another request may have refreshed the token
     * immediately before our UPDATE acquired the lock.
     */

    installation =
      await repository.find(
        "gohighlevel",

        "company",

        normalizedCompanyId,
      );


    if (
      !installation
    ) {

      throw new Error(
        `GHL company OAuth installation disappeared after acquiring refresh lock for company=${normalizedCompanyId}.`,
      );
    }


    const reloadedAccessToken =
      normalizeToken(
        installation.accessToken,
      );


    /*
     * If another worker refreshed the token immediately
     * before our lock acquisition, do not consume the
     * refresh token again.
     */

    if (
      reloadedAccessToken &&

      !needsRefresh(
        installation,
      )
    ) {

      return reloadedAccessToken;
    }


    /*
     * ------------------------------------------------
     * 6. Get current refresh token
     * ------------------------------------------------
     */

    const currentRefreshToken =
      normalizeToken(
        installation.refreshToken,
      );


    /*
     * ------------------------------------------------
     * 7. Normal refresh OR automatic reconnect
     * ------------------------------------------------
     */

    let refreshed:
      Awaited<
        ReturnType<
          typeof refreshGHLCompanyAccessToken
        >
      >;


    try {

      /*
       * ----------------------------------------------
       * 7A. Normal refresh
       * ----------------------------------------------
       */

      if (
        !currentRefreshToken
      ) {

        throw new Error(
          `GHL company OAuth installation for company=${normalizedCompanyId} has no refresh token.`,
        );
      }


      refreshed =
        await refreshGHLCompanyAccessToken(
          env,

          currentRefreshToken,
        );

    } catch (
      error: unknown
    ) {

      /*
       * Only a missing refresh token or an actual
       * invalid_grant enters OAuth recovery.
       *
       * Network failures, 5xx responses, rate limits,
       * and unrelated OAuth errors are not converted
       * into reconnect attempts.
       */

      const shouldReconnect =
        !currentRefreshToken ||

        isGHLInvalidGrantError(
          error,
        );


      if (
        !shouldReconnect
      ) {

        throw error;
      }


      console.warn(
        "GHL Company OAuth refresh unavailable; attempting automatic reconnect.",
        {
          companyId:
            normalizedCompanyId,

          reason:
            !currentRefreshToken
              ? "missing_refresh_token"
              : "invalid_grant",
        },
      );


      /*
       * ----------------------------------------------
       * 7B. Automatic Company reconnect
       * ----------------------------------------------
       */

      try {

        refreshed =
          await reconnectGHLCompanyAccessToken(
            env,

            normalizedCompanyId,
          );


        console.info(
          "GHL Company OAuth reconnect succeeded.",
          {
            companyId:
              normalizedCompanyId,
          },
        );

      } catch (
        recoveryError: unknown
      ) {

        /*
         * Reconnect failed.
         *
         * Do not silently convert this into success.
         * The caller must know that OAuth recovery failed.
         */

        console.error(
          "GHL Company OAuth automatic recovery failed.",
          {
            companyId:
              normalizedCompanyId,

            error:
              recoveryError instanceof
              Error

                ? recoveryError.message

                : recoveryError,
          },
        );


        throw recoveryError;
      }
    }


    /*
     * ------------------------------------------------
     * 8. Validate refreshed access token
     * ------------------------------------------------
     */

    const refreshedAccessToken =
      normalizeToken(
        refreshed.access_token,
      );


    if (
      !refreshedAccessToken
    ) {

      throw new Error(
        `HighLevel returned an empty Company access token for company=${normalizedCompanyId}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 9. Calculate new expiry
     * ------------------------------------------------
     */

    const accessTokenExpiresAt =
      typeof refreshed.expires_in ===
      "number"

        ? Date.now() +
          (
            refreshed.expires_in *
            1000
          )

        : null;


    /*
     * ------------------------------------------------
     * 10. Preserve/update metadata
     * ------------------------------------------------
     */

    const metadata =
      buildRefreshMetadata(
        installation.metadata,

        refreshed.expires_in,
      );


    /*
     * ------------------------------------------------
     * 11. Persist rotated token pair
     * ------------------------------------------------
     *
     * HighLevel may return a new refresh token.
     *
     * Pass the new token when present.
     *
     * If HighLevel does not return a replacement token,
     * the repository should preserve the existing one.
     */

    const returnedRefreshToken =
      normalizeToken(
        refreshed.refresh_token,
      );


    const saved =
      await repository
        .saveRefreshedToken(
          "gohighlevel",

          "company",

          normalizedCompanyId,

          lockToken,

          refreshedAccessToken,

          returnedRefreshToken ||
            null,

          accessTokenExpiresAt,

          metadata,
        );


    if (
      !saved
    ) {

      throw new Error(
        `Failed to persist refreshed GHL company OAuth credential for company=${normalizedCompanyId}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 12. Return the fresh access token
     * ------------------------------------------------
     */

    return refreshedAccessToken;

  } finally {

    /*
     * Always release our lease.
     *
     * The repository should only release the lock when
     * the supplied lockToken matches the current owner.
     */

    await repository
      .releaseRefreshLock(
        "gohighlevel",

        "company",

        normalizedCompanyId,

        lockToken,
      );
  }
}
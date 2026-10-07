import {
  CredentialRepository,
} from "../../persistence/repositories/credential-repository";

import type {
  IntegrationCredential,
} from "../../persistence/models/integration-credential";

import type {
  IntegrationCredentialRequest,
  IntegrationCredentialResolver,
  IntegrationRuntime,
  ResolvedIntegrationCredential,
} from "../../core/integration/runtime";

import {
  isGHLInvalidGrantError,
  refreshGHLLocationAccessToken,
} from "../messaging/gohighlevel/oauth";


/*
 * --------------------------------------------------
 * GHL runtime configuration
 * --------------------------------------------------
 */

export interface GHLRuntimeEnvironment {

  GHL_OAUTH_CLIENT_ID:
    string;

  GHL_OAUTH_CLIENT_SECRET:
    string;
}


/*
 * --------------------------------------------------
 * Refresh settings
 * --------------------------------------------------
 *
 * Refresh slightly before expiry so an API request
 * does not begin with a token that is about to expire.
 */

const REFRESH_SKEW_MS =
  5 * 60 * 1000;


/*
 * --------------------------------------------------
 * Refresh lock settings
 * --------------------------------------------------
 */

const REFRESH_LOCK_DURATION_MS =
  30 * 1000;


/*
 * --------------------------------------------------
 * Concurrent refresh wait
 * --------------------------------------------------
 *
 * If another Worker currently owns the refresh lock,
 * briefly wait for that Worker to persist the new token.
 */

const REFRESH_WAIT_ATTEMPTS =
  4;

const REFRESH_WAIT_MS =
  250;




/*
 * --------------------------------------------------
 * Sleep helper
 * --------------------------------------------------
 */

function sleep(
  milliseconds:
    number,
): Promise<void> {

  return new Promise(
    (resolve) =>
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
 * Metadata parser
 * --------------------------------------------------
 */

function parseMetadata(
  metadataValue:
    string | null | undefined,
): Record<
  string,
  unknown
> {

  if (
    typeof metadataValue ===
    "string"
  ) {

    try {

      const parsed =
        JSON.parse(
          metadataValue,
        );


      if (
        typeof parsed ===
          "object" &&

        parsed !== null &&

        !Array.isArray(
          parsed,
        )
      ) {

        return parsed as Record<
          string,
          unknown
        >;
      }

    } catch {

      /*
       * Invalid legacy metadata should not prevent
       * OAuth refresh/recovery.
       */
    }
  }


  return {};
}


/*
 * --------------------------------------------------
 * Recovery failure metadata
 * --------------------------------------------------
 */

function buildOAuthReauthorizationMetadata(
  existingMetadata:
    string | null | undefined,
): string {

  const metadata =
    parseMetadata(
      existingMetadata,
    );

  metadata.oauthRecoveryStatus =
    "reauthorization_required";

  metadata.oauthRecoveryLastAttemptAt =
    new Date().toISOString();

  delete metadata.oauthRecoveryNextAttemptAt;

  return JSON.stringify(
    metadata,
  );
}

/*
 * --------------------------------------------------
 * Credential expiry
 * --------------------------------------------------
 */

function needsRefresh(
  credential:
    IntegrationCredential,
): boolean {

  /*
   * No expiry information means the runtime cannot
   * prove that the OAuth token is currently valid.
   *
   * Treat it as requiring refresh.
   */

  if (
    credential.accessTokenExpiresAt ===
      null ||

    credential.accessTokenExpiresAt ===
      undefined
  ) {

    return (
      credential.authType ===
      "oauth2"
    );
  }


  return (
    credential.accessTokenExpiresAt -
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

        parsed !== null &&

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
       * Invalid legacy metadata should not prevent
       * successful OAuth refresh.
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


  metadata.oauthRecoveryStatus =
    "active";


  delete metadata.oauthRecoveryNextAttemptAt;

  delete metadata.oauthRecoveryLastAttemptAt;


  return JSON.stringify(
    metadata,
  );
}


/*
 * --------------------------------------------------
 * GHL credential resolver
 * --------------------------------------------------
 */

export class GHLIntegrationCredentialResolver
  implements IntegrationCredentialResolver {


  constructor(
    private readonly db:
      D1Database,

    private readonly env:
      GHLRuntimeEnvironment,
  ) {}


  async resolve(
    request:
      IntegrationCredentialRequest,
  ): Promise<
    ResolvedIntegrationCredential
  > {

    const repository =
      new CredentialRepository(
        this.db,
      );


    /*
     * ------------------------------------------------
     * 1. Validate provider
     * ------------------------------------------------
     */

    if (
      request.provider !==
      "gohighlevel"
    ) {

      throw new Error(
        `GHL credential resolver cannot resolve provider=${request.provider}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 2. Load tenant credential
     * ------------------------------------------------
     */

    let credential =
      await repository
        .findByTenantAndProvider(
          request.tenantId,
          "gohighlevel",
        );


    if (
      !credential
    ) {

      throw new Error(
        `No GoHighLevel credential found for tenant=${request.tenantId}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 3. Validate requested resource
     * ------------------------------------------------
     *
     * For GHL the generic resourceId maps to the
     * Location ID.
     */

    if (
      request.resourceId &&

      credential.locationId &&

      credential.locationId !==
        request.resourceId
    ) {

      throw new Error(
        `GHL credential location mismatch for tenant=${request.tenantId}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 4. Static API key / PIT
     * ------------------------------------------------
     *
     * PIT credentials never enter the OAuth refresh
     * path.
     */

    if (
      credential.authType ===
      "api_key"
    ) {

      const accessToken =
        normalizeToken(
          credential.apiKey,
        );


      if (
        !accessToken
      ) {

        throw new Error(
          `GHL API-key credential is empty for tenant=${request.tenantId}.`,
        );
      }


      return {
        authType:
          "api_key",

        accessToken,

        resourceId:
          credential.locationId ??
          null,

        expiresAt:
          null,
      };
    }


    /*
     * ------------------------------------------------
     * 5. OAuth credential validation
     * ------------------------------------------------
     */

    if (
      credential.authType !==
      "oauth2"
    ) {

      throw new Error(
        `Unsupported GHL authentication type: ${credential.authType}`,
      );
    }


    /*
     * ------------------------------------------------
     * 6. Existing OAuth token still valid
     * ------------------------------------------------
     *
     * IMPORTANT:
     *
     * An empty OAuth access token is allowed to continue
     * into refresh/recovery.
     *
     * This supports broken/legacy credentials where the
     * Location ID still exists but the token is missing.
     */

 const existingAccessToken =
  normalizeToken(
    credential.apiKey,
  );


const initialAccessToken =
  normalizeToken(
    credential.apiKey,
  );


if (
  !request.forceRefresh &&
  existingAccessToken &&
  !needsRefresh(
    credential,
  )
) {

  return {
    authType:
      "oauth2",

    accessToken:
      existingAccessToken,

    resourceId:
      credential.locationId ??
      null,

    expiresAt:
      credential.accessTokenExpiresAt ??
      null,
  };
}
  


    /*
     * ------------------------------------------------
     * 7. Acquire refresh/recovery lease
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
        .acquireOAuthRefreshLock(
          request.tenantId,

          "gohighlevel",

          lockToken,

          now,

          lockExpiresAt,
        );


    /*
     * ------------------------------------------------
     * 9. Another Worker is refreshing/recovering
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


        credential =
          await repository
            .findByTenantAndProvider(
              request.tenantId,
              "gohighlevel",
            );


        if (
          !credential
        ) {

          throw new Error(
            `GHL credential disappeared while waiting for OAuth refresh for tenant=${request.tenantId}.`,
          );
        }


        if (
          credential.authType ===
          "api_key"
        ) {

          throw new Error(
            `GHL credential authentication mode changed unexpectedly for tenant=${request.tenantId}.`,
          );
        }


        const latestAccessToken =
          normalizeToken(
            credential.apiKey,
          );


        const tokenChanged =
          latestAccessToken !==
          initialAccessToken;


        if (
          latestAccessToken &&

          (
            tokenChanged ||

            (
              !request.forceRefresh &&

              !needsRefresh(
                credential,
              )
            )
          )
        ) {

          return {
            authType:
              "oauth2",

            accessToken:
              latestAccessToken,

            resourceId:
              credential.locationId ??
              null,

            expiresAt:
              credential.accessTokenExpiresAt ??
              null,
          };
        }
      }


      throw new Error(
        `GHL OAuth token refresh is already in progress for tenant=${request.tenantId}.`,
      );
    }


    /*
     * ------------------------------------------------
     * 10. We own the refresh/recovery lease
     * ------------------------------------------------
     */

    try {

      /*
       * Reload after acquiring the lock.
       *
       * Another request may have refreshed the token
       * immediately before our UPDATE acquired the lock.
       */

      credential =
        await repository
          .findByTenantAndProvider(
            request.tenantId,
            "gohighlevel",
          );


      if (
        !credential
      ) {

        throw new Error(
          `GHL credential disappeared after acquiring refresh lock for tenant=${request.tenantId}.`,
        );
      }


      if (
        credential.authType !==
        "oauth2"
      ) {

        throw new Error(
          `GHL credential authentication mode changed unexpectedly for tenant=${request.tenantId}.`,
        );
      }


      /*
       * If the token is already fresh after the reload,
       * do not consume the refresh token unnecessarily.
       */

      const reloadedAccessToken =
        normalizeToken(
          credential.apiKey,
        );


      const tokenChangedAfterReload =
        reloadedAccessToken !==
        initialAccessToken;


      if (
        reloadedAccessToken &&

        (
          tokenChangedAfterReload ||

          (
            !request.forceRefresh &&

            !needsRefresh(
              credential,
            )
          )
        )
      ) {

        return {
          authType:
            "oauth2",

          accessToken:
            reloadedAccessToken,

          resourceId:
            credential.locationId ??
            null,

          expiresAt:
            credential.accessTokenExpiresAt ??
            null,
        };
      }


      /*
       * ------------------------------------------------
       * 11. Get current refresh token
       * ------------------------------------------------
       */

      const currentRefreshToken =
        normalizeToken(
          credential.refreshToken,
        );


      /*
       * /*
 * ------------------------------------------------
 * 12. Refresh Location token
 * ------------------------------------------------
 *
 * Only the standard OAuth refresh-token flow is
 * automatic.
 *
 * If HighLevel returns invalid_grant, the stored
 * OAuth authorization is no longer usable and the
 * installation must be reauthorized.
 */

let refreshed:
  Awaited<
    ReturnType<
      typeof refreshGHLLocationAccessToken
    >
  >;

try {

  if (
    !currentRefreshToken
  ) {

    throw new Error(
      `GHL OAuth credential for tenant=${request.tenantId} has no refresh token. Reauthorization is required.`,
    );
  }


  refreshed =
    await refreshGHLLocationAccessToken(
      this.env,

      currentRefreshToken,
    );

} catch (
  error:
    unknown
) {

  if (
    isGHLInvalidGrantError(
      error,
    )
  ) {

    const recoveryMetadata =
      buildOAuthReauthorizationMetadata(
        credential.metadata,
      );

    await repository
      .updateOAuthMetadata(
        request.tenantId,

        "gohighlevel",

        recoveryMetadata,
      );

    throw new Error(
      `GHL OAuth authorization is no longer valid for tenant=${request.tenantId}. Reauthorization is required.`,
    );
  }


  throw error;
}
     
      /*
       * ------------------------------------------------
       * 13. Calculate new expiry
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
       * 14. Preserve/update metadata
       * ------------------------------------------------
       */

      const metadata =
        buildRefreshMetadata(
          credential.metadata,

          refreshed.expires_in,
        );


      /*
       * ------------------------------------------------
       * 15. Persist rotated token pair
       * ------------------------------------------------
       *
       * HighLevel may rotate the refresh token.
       *
       * If HighLevel returns a new refresh token,
       * save it.
       *
       * If it does not return one, preserve the current
       * refresh token through the repository's COALESCE
       * behavior.
       */

      const returnedRefreshToken =
        normalizeToken(
          refreshed.refresh_token,
        );

        

      const saved =
        await repository
          .saveRefreshedOAuthCredential(
            request.tenantId,

            "gohighlevel",

            lockToken,

            refreshed.access_token,

            returnedRefreshToken
              ? returnedRefreshToken
              : null,

            accessTokenExpiresAt,

            metadata,
          );


      if (
        !saved
      ) {

        throw new Error(
          `Failed to persist refreshed GHL OAuth credential for tenant=${request.tenantId}.`,
        );
      }


      /*
       * ------------------------------------------------
       * 16. Return fresh access token
       * ------------------------------------------------
       */

      return {
        authType:
          "oauth2",

        accessToken:
          refreshed.access_token,

        resourceId:
          credential.locationId ??
          null,

        expiresAt:
          accessTokenExpiresAt,
      };

    } finally {

      /*
       * saveRefreshedOAuthCredential() clears the
       * lock on success.
       *
       * On failure, explicitly release it.
       *
       * The repository should only release the lock
       * when lockToken matches.
       */

      await repository
        .releaseOAuthRefreshLock(
          request.tenantId,

          "gohighlevel",

          lockToken,
        );
    }
  }
}


/*
 * --------------------------------------------------
 * GHL Integration Runtime factory
 * --------------------------------------------------
 */

export function createGHLIntegrationRuntime(
  db:
    D1Database,

  env:
    GHLRuntimeEnvironment,
): IntegrationRuntime {

  return {

    credentials:
      new GHLIntegrationCredentialResolver(
        db,

        env,
      ),
  };
}
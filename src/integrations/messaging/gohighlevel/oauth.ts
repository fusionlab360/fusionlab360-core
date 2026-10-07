export interface GHLCompanyOAuthTokenResponse {
  access_token: string;

  token_type: string;

  expires_in?: number;

  refresh_token?: string;

  scope?: string;

  userType?: string;

  companyId?: string;

  userId?: string;

  isBulkInstallation?: boolean;

  approvedLocations?: string[];

  installToFutureLocations?: boolean;

  approveAllLocations?: boolean;
}


export interface GHLLocationOAuthTokenResponse {
  access_token: string;

  token_type: string;

  expires_in?: number;

  refresh_token?: string;

  scope?: string;

  userType?: string;

  companyId?: string;

  locationId?: string;

  userId?: string;

  appId?: string;

  versionId?: string;

  planId?: string;
}


export type GHLUserType =
  | "Company"
  | "Location";


export interface GHLReconnectResponse {
  authorizationCode: string;

  expiresAt?: string;

  traceId?: string;
}


/*
 * --------------------------------------------------
 * Constants
 * --------------------------------------------------
 */

const GHL_OAUTH_TOKEN_URL =
  "https://services.leadconnectorhq.com/oauth/token";


const GHL_OAUTH_RECONNECT_URL =
  "https://services.leadconnectorhq.com/oauth/reconnect";


const GHL_LOCATION_TOKEN_URL =
  "https://services.leadconnectorhq.com/oauth/location-token";


const GHL_API_VERSION =
  "v3";


const GHL_REDIRECT_URI =
  "https://api.fusionlab360.com/oauth/gohighlevel/callback";


/*
 * --------------------------------------------------
 * Environment helper
 * --------------------------------------------------
 */

function getRequiredBinding(
  value:
    string | undefined,

  name:
    string,
): string {

  if (
    !value ||
    !value.trim()
  ) {

    throw new Error(
      `${name} is not configured.`,
    );
  }


  return value.trim();
}


/*
 * --------------------------------------------------
 * Structured OAuth errors
 * --------------------------------------------------
 */

export class GHLInvalidGrantError
  extends Error {

  readonly status:
    number;

  readonly code:
    "invalid_grant";


  constructor(
    status:
      number,

    message:
      string,
  ) {

    super(
      message,
    );


    this.name =
      "GHLInvalidGrantError";


    this.status =
      status;


    this.code =
      "invalid_grant";
  }
}


/*
 * --------------------------------------------------
 * Invalid-grant detection
 * --------------------------------------------------
 */

export function isGHLInvalidGrantError(
  error:
    unknown,
): boolean {

  if (
    error instanceof
    GHLInvalidGrantError
  ) {

    return true;
  }


  if (
    !(error instanceof Error)
  ) {

    return false;
  }


  return (
    error.message
      .toLowerCase()
      .includes(
        "invalid_grant",
      )
  );
}


/*
 * --------------------------------------------------
 * Generic OAuth response parser
 * --------------------------------------------------
 */

async function parseOAuthTokenResponse(
  response:
    Response,
): Promise<
  Record<string, unknown> & {
    access_token:
      string;
  }
> {

  const raw =
    await response.text();


  let payload:
    unknown =
    null;


  try {

    payload =
      raw
        ? JSON.parse(raw)
        : null;

  } catch {

    payload =
      raw;
  }


  if (
    !response.ok
  ) {

    const serialized =
      typeof payload ===
      "string"

        ? payload

        : JSON.stringify(
            payload,
          );


    const message =
      `HighLevel OAuth token request failed (${response.status}): ${serialized}`;


    if (
      typeof payload ===
        "object" &&

      payload !== null &&

      !Array.isArray(
        payload,
      ) &&

      (
        payload as
          Record<
            string,
            unknown
          >
      ).error ===
        "invalid_grant"
    ) {

      throw new GHLInvalidGrantError(
        response.status,

        message,
      );
    }


    throw new Error(
      message,
    );
  }


  if (
    typeof payload !==
      "object" ||

    payload === null ||

    Array.isArray(
      payload,
    )
  ) {

    throw new Error(
      "HighLevel OAuth token response was invalid.",
    );
  }


  const token =
    payload as Record<
      string,
      unknown
    >;


  if (
    typeof token.access_token !==
    "string" ||

    !token.access_token.trim()
  ) {

    throw new Error(
      "HighLevel OAuth response did not contain access_token.",
    );
  }


  return {
    ...token,

    access_token:
      token.access_token.trim(),
  };
}


/*
 * --------------------------------------------------
 * Type conversion helpers
 * --------------------------------------------------
 */

function toStringOrUndefined(
  value:
    unknown,
): string | undefined {

  return typeof value ===
    "string" &&
    value.trim()

    ? value.trim()

    : undefined;
}


function toNumberOrUndefined(
  value:
    unknown,
): number | undefined {

  return typeof value ===
    "number" &&
    Number.isFinite(
      value,
    )

    ? value

    : undefined;
}


function toBooleanOrUndefined(
  value:
    unknown,
): boolean | undefined {

  return typeof value ===
    "boolean"

    ? value

    : undefined;
}


function toStringArrayOrUndefined(
  value:
    unknown,
): string[] | undefined {

  if (
    !Array.isArray(
      value,
    )
  ) {

    return undefined;
  }


  return value
    .filter(
      (
        item,
      ): item is string =>
        typeof item ===
        "string" &&
        item.trim().length >
          0,
    )
    .map(
      (
        item,
      ) =>
        item.trim(),
    );
}


/*
 * --------------------------------------------------
 * Company token mapper
 * --------------------------------------------------
 */

function mapCompanyOAuthToken(
  token:
    Record<string, unknown>,
): GHLCompanyOAuthTokenResponse {

  const accessToken =
    toStringOrUndefined(
      token.access_token,
    );


  if (
    !accessToken
  ) {

    throw new Error(
      "HighLevel OAuth response did not contain access_token.",
    );
  }


  return {

    access_token:
      accessToken,

    token_type:
      toStringOrUndefined(
        token.token_type,
      ) ??
      "Bearer",

    expires_in:
      toNumberOrUndefined(
        token.expires_in,
      ),

    refresh_token:
      toStringOrUndefined(
        token.refresh_token,
      ),

    scope:
      toStringOrUndefined(
        token.scope,
      ),

    userType:
      toStringOrUndefined(
        token.userType,
      ),

    companyId:
      toStringOrUndefined(
        token.companyId,
      ),

    userId:
      toStringOrUndefined(
        token.userId,
      ),

    isBulkInstallation:
      toBooleanOrUndefined(
        token.isBulkInstallation,
      ),

    approvedLocations:
      toStringArrayOrUndefined(
        token.approvedLocations,
      ),

    installToFutureLocations:
      toBooleanOrUndefined(
        token.installToFutureLocations,
      ),

    approveAllLocations:
      toBooleanOrUndefined(
        token.approveAllLocations,
      ),
  };
}


/*
 * --------------------------------------------------
 * Location token mapper
 * --------------------------------------------------
 */

function mapLocationOAuthToken(
  token:
    Record<string, unknown>,

  fallbackLocationId?:
    string,
): GHLLocationOAuthTokenResponse {

  const accessToken =
    toStringOrUndefined(
      token.access_token,
    );


  if (
    !accessToken
  ) {

    throw new Error(
      "HighLevel OAuth response did not contain access_token.",
    );
  }


  return {

    access_token:
      accessToken,

    token_type:
      toStringOrUndefined(
        token.token_type,
      ) ??
      "Bearer",

    expires_in:
      toNumberOrUndefined(
        token.expires_in,
      ),

    refresh_token:
      toStringOrUndefined(
        token.refresh_token,
      ),

    scope:
      toStringOrUndefined(
        token.scope,
      ),

    userType:
      toStringOrUndefined(
        token.userType,
      ),

    companyId:
      toStringOrUndefined(
        token.companyId,
      ),

    locationId:
      toStringOrUndefined(
        token.locationId,
      ) ??
      (
        fallbackLocationId
          ? fallbackLocationId.trim()
          : undefined
      ),

    userId:
      toStringOrUndefined(
        token.userId,
      ),

    appId:
      toStringOrUndefined(
        token.appId,
      ),

    versionId:
      toStringOrUndefined(
        token.versionId,
      ),

    planId:
      toStringOrUndefined(
        token.planId,
      ),
  };
}


/*
 * --------------------------------------------------
 * Authorization-code exchange
 * --------------------------------------------------
 */

export async function exchangeGHLAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  code:
    string,
): Promise<
  GHLCompanyOAuthTokenResponse
>;


export async function exchangeGHLAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  code:
    string,

  userType:
    "Company",
): Promise<
  GHLCompanyOAuthTokenResponse
>;


export async function exchangeGHLAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  code:
    string,

  userType:
    "Location",
): Promise<
  GHLLocationOAuthTokenResponse
>;


export async function exchangeGHLAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  code:
    string,

  userType:
    GHLUserType =
      "Company",
):
Promise<
  GHLCompanyOAuthTokenResponse |
  GHLLocationOAuthTokenResponse
> {

  const clientId =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_ID,
      "GHL_OAUTH_CLIENT_ID",
    );


  const clientSecret =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_SECRET,
      "GHL_OAUTH_CLIENT_SECRET",
    );


  const normalizedCode =
    code.trim();


  if (
    !normalizedCode
  ) {

    throw new Error(
      "HighLevel OAuth authorization code is required.",
    );
  }


  const body =
    new URLSearchParams();


  body.set(
    "client_id",
    clientId,
  );


  body.set(
    "client_secret",
    clientSecret,
  );


  body.set(
    "grant_type",
    "authorization_code",
  );


  body.set(
    "code",
    normalizedCode,
  );


  body.set(
    "user_type",
    userType,
  );


  body.set(
    "redirect_uri",
    GHL_REDIRECT_URI,
  );


  const response =
    await fetch(
      GHL_OAUTH_TOKEN_URL,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded",

          Version:
            GHL_API_VERSION,
        },

        body:
          body.toString(),
      },
    );


  const token =
    await parseOAuthTokenResponse(
      response,
    );


  if (
    userType ===
    "Location"
  ) {

    return mapLocationOAuthToken(
      token,
    );
  }


  return mapCompanyOAuthToken(
    token,
  );
}


/*
 * --------------------------------------------------
 * GHL Reconnect API
 * --------------------------------------------------
 */

export async function requestGHLReconnectAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  target:
    | {
        userType:
          "Company";

        companyId:
          string;
      }

    | {
        userType:
          "Location";

        locationId:
          string;
      },
): Promise<
  GHLReconnectResponse
> {

  const clientId =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_ID,
      "GHL_OAUTH_CLIENT_ID",
    );


  const clientSecret =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_SECRET,
      "GHL_OAUTH_CLIENT_SECRET",
    );


  const companyId =
    target.userType ===
      "Company"

      ? target.companyId.trim()

      : "";


  const locationId =
    target.userType ===
      "Location"

      ? target.locationId.trim()

      : "";


  if (
    target.userType ===
      "Company" &&
    !companyId
  ) {

    throw new Error(
      "HighLevel companyId is required for OAuth reconnect.",
    );
  }


  if (
    target.userType ===
      "Location" &&
    !locationId
  ) {

    throw new Error(
      "HighLevel locationId is required for OAuth reconnect.",
    );
  }


  const requestBody =
    target.userType ===
      "Company"

      ? {
          clientKey:
            clientId,

          clientSecret:
            clientSecret,

          companyId:
            companyId,
        }

      : {
          clientKey:
            clientId,

          clientSecret:
            clientSecret,

          locationId:
            locationId,
        };


  const response =
    await fetch(
      GHL_OAUTH_RECONNECT_URL,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            requestBody,
          ),
      },
    );


  const raw =
    await response.text();


  let payload:
    unknown =
    null;


  try {

    payload =
      raw
        ? JSON.parse(raw)
        : null;

  } catch {

    payload =
      raw;
  }


  if (
    !response.ok
  ) {

    const serialized =
      typeof payload ===
      "string"

        ? payload

        : JSON.stringify(
            payload,
          );


    throw new Error(
      `HighLevel OAuth reconnect request failed (${response.status}): ${serialized}`,
    );
  }


  if (
    typeof payload !==
      "object" ||

    payload === null ||

    Array.isArray(
      payload,
    )
  ) {

    throw new Error(
      "HighLevel OAuth reconnect response was invalid.",
    );
  }


  const reconnect =
    payload as Record<
      string,
      unknown
    >;


  const authorizationCode =
    toStringOrUndefined(
      reconnect.authorizationCode,
    );


  if (
    !authorizationCode
  ) {

    throw new Error(
      "HighLevel OAuth reconnect response did not contain authorizationCode.",
    );
  }


  return {

    authorizationCode,

    expiresAt:
      toStringOrUndefined(
        reconnect.expiresAt,
      ),

    traceId:
      toStringOrUndefined(
        reconnect.traceId,
      ),
  };
}


/*
 * --------------------------------------------------
 * Automatic Company reconnect
 * --------------------------------------------------
 */

export async function reconnectGHLCompanyAccessToken(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  companyId:
    string,
): Promise<
  GHLCompanyOAuthTokenResponse
> {

  const reconnect =
    await requestGHLReconnectAuthorizationCode(
      env,

      {
        userType:
          "Company",

        companyId:
          companyId,
      },
    );


  return exchangeGHLAuthorizationCode(
    env,

    reconnect.authorizationCode,

    "Company",
  );
}


/*
 * --------------------------------------------------
 * Automatic Location reconnect
 * --------------------------------------------------
 */

export async function reconnectGHLLocationAccessToken(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  locationId:
    string,
): Promise<
  GHLLocationOAuthTokenResponse
> {

  const normalizedLocationId =
    locationId.trim();


  if (
    !normalizedLocationId
  ) {

    throw new Error(
      "HighLevel locationId is required for OAuth reconnect.",
    );
  }


  const reconnect =
    await requestGHLReconnectAuthorizationCode(
      env,

      {
        userType:
          "Location",

        locationId:
          normalizedLocationId,
      },
    );


  return exchangeGHLAuthorizationCode(
    env,

    reconnect.authorizationCode,

    "Location",
  );
}


/*
 * --------------------------------------------------
 * Refresh Company token
 * --------------------------------------------------
 */

export async function refreshGHLCompanyAccessToken(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  refreshToken:
    string,
): Promise<
  GHLCompanyOAuthTokenResponse
> {

  const clientId =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_ID,
      "GHL_OAUTH_CLIENT_ID",
    );


  const clientSecret =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_SECRET,
      "GHL_OAUTH_CLIENT_SECRET",
    );


  const normalizedRefreshToken =
    refreshToken.trim();


  if (
    !normalizedRefreshToken
  ) {

    throw new Error(
      "HighLevel Company refresh token is required.",
    );
  }


  const body =
    new URLSearchParams();


  body.set(
    "client_id",
    clientId,
  );


  body.set(
    "client_secret",
    clientSecret,
  );


  body.set(
    "grant_type",
    "refresh_token",
  );


  body.set(
    "refresh_token",
    normalizedRefreshToken,
  );


  body.set(
    "user_type",
    "Company",
  );


  body.set(
    "redirect_uri",
    GHL_REDIRECT_URI,
  );


  const response =
    await fetch(
      GHL_OAUTH_TOKEN_URL,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded",

          Version:
            GHL_API_VERSION,
        },

        body:
          body.toString(),
      },
    );


  const token =
    await parseOAuthTokenResponse(
      response,
    );


  return mapCompanyOAuthToken(
    token,
  );
}


/*
 * --------------------------------------------------
 * Company -> Location token
 * --------------------------------------------------
 */

export async function exchangeGHLCompanyTokenForLocationToken(
  companyAccessToken:
    string,

  companyId:
    string,

  locationId:
    string,
): Promise<
  GHLLocationOAuthTokenResponse
> {

  const normalizedCompanyAccessToken =
    companyAccessToken.trim();


  const normalizedCompanyId =
    companyId.trim();


  const normalizedLocationId =
    locationId.trim();


  if (
    !normalizedCompanyAccessToken
  ) {

    throw new Error(
      "HighLevel Company access token is required.",
    );
  }


  if (
    !normalizedCompanyId
  ) {

    throw new Error(
      "HighLevel companyId is required.",
    );
  }


  if (
    !normalizedLocationId
  ) {

    throw new Error(
      "HighLevel locationId is required.",
    );
  }


  const body =
    new URLSearchParams();


  body.set(
    "companyId",
    normalizedCompanyId,
  );


  body.set(
    "locationId",
    normalizedLocationId,
  );


  const response =
    await fetch(
      GHL_LOCATION_TOKEN_URL,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded",

          Version:
            GHL_API_VERSION,

          Authorization:
            `Bearer ${normalizedCompanyAccessToken}`,
        },

        body:
          body.toString(),
      },
    );


  const token =
    await parseOAuthTokenResponse(
      response,
    );


  return mapLocationOAuthToken(
    token,

    normalizedLocationId,
  );
}


/*
 * --------------------------------------------------
 * Refresh Location token
 * --------------------------------------------------
 */

export async function refreshGHLLocationAccessToken(
  env: {
    GHL_OAUTH_CLIENT_ID?:
      string;

    GHL_OAUTH_CLIENT_SECRET?:
      string;
  },

  refreshToken:
    string,
): Promise<
  GHLLocationOAuthTokenResponse
> {

  const clientId =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_ID,
      "GHL_OAUTH_CLIENT_ID",
    );


  const clientSecret =
    getRequiredBinding(
      env.GHL_OAUTH_CLIENT_SECRET,
      "GHL_OAUTH_CLIENT_SECRET",
    );


  const normalizedRefreshToken =
    refreshToken.trim();


  if (
    !normalizedRefreshToken
  ) {

    throw new Error(
      "HighLevel Location refresh token is required.",
    );
  }


  const body =
    new URLSearchParams();


  body.set(
    "client_id",
    clientId,
  );


  body.set(
    "client_secret",
    clientSecret,
  );


  body.set(
    "grant_type",
    "refresh_token",
  );


  body.set(
    "refresh_token",
    normalizedRefreshToken,
  );


  body.set(
    "user_type",
    "Location",
  );


  body.set(
    "redirect_uri",
    GHL_REDIRECT_URI,
  );


  const response =
    await fetch(
      GHL_OAUTH_TOKEN_URL,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded",

          Version:
            GHL_API_VERSION,
        },

        body:
          body.toString(),
      },
    );


  const token =
    await parseOAuthTokenResponse(
      response,
    );


  return mapLocationOAuthToken(
    token,
  );
}
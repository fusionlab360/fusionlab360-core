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


const GHL_OAUTH_TOKEN_URL =
  "https://services.leadconnectorhq.com/oauth/token";


const GHL_API_VERSION =
  "v3";


const GHL_REDIRECT_URI =
  "https://api.fusionlab360.com/oauth/gohighlevel/callback";


function getRequiredBinding(
  value: string | undefined,
  name: string,
): string {

  if (!value) {
    throw new Error(
      `${name} is not configured.`,
    );
  }

  return value;
}


/**
 * Exchange the HighLevel authorization code
 * for the Company/Agency OAuth token.
 */
export async function exchangeGHLAuthorizationCode(
  env: {
    GHL_OAUTH_CLIENT_ID?: string;

    GHL_OAUTH_CLIENT_SECRET?: string;
  },

  code: string,
): Promise<GHLCompanyOAuthTokenResponse> {

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
    code,
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


  const raw =
    await response.text();


  let payload:
    unknown = null;


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

    throw new Error(
      `HighLevel OAuth token exchange failed (${response.status}): ` +
      `${typeof payload === "string"
        ? payload
        : JSON.stringify(payload)}`,
    );
  }


  if (
    typeof payload !== "object" ||
    payload === null
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
    "string"
  ) {

    throw new Error(
      "HighLevel OAuth response did not contain access_token.",
    );
  }


  return {
    access_token:
      token.access_token,

    token_type:
      typeof token.token_type ===
      "string"
        ? token.token_type
        : "Bearer",

    expires_in:
      typeof token.expires_in ===
      "number"
        ? token.expires_in
        : undefined,

    refresh_token:
      typeof token.refresh_token ===
      "string"
        ? token.refresh_token
        : undefined,

    scope:
      typeof token.scope ===
      "string"
        ? token.scope
        : undefined,

    userType:
      typeof token.userType ===
      "string"
        ? token.userType
        : undefined,

    companyId:
      typeof token.companyId ===
      "string"
        ? token.companyId
        : undefined,

    userId:
      typeof token.userId ===
      "string"
        ? token.userId
        : undefined,

    isBulkInstallation:
      typeof token.isBulkInstallation ===
      "boolean"
        ? token.isBulkInstallation
        : undefined,

    approvedLocations:
      Array.isArray(
        token.approvedLocations,
      )
        ? token.approvedLocations.filter(
            (
              value,
            ): value is string =>
              typeof value ===
              "string",
          )
        : undefined,

    installToFutureLocations:
      typeof token.installToFutureLocations ===
      "boolean"
        ? token.installToFutureLocations
        : undefined,

    approveAllLocations:
      typeof token.approveAllLocations ===
      "boolean"
        ? token.approveAllLocations
        : undefined,
  };
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


export async function exchangeGHLCompanyTokenForLocationToken(
  companyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<GHLLocationOAuthTokenResponse> {

  const body =
    new URLSearchParams();

  body.set(
    "companyId",
    companyId,
  );

  body.set(
    "locationId",
    locationId,
  );


  const response =
    await fetch(
      "https://services.leadconnectorhq.com/oauth/location-token",
      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded",

          Version:
            "v3",

          Authorization:
            `Bearer ${companyAccessToken}`,
        },

        body:
          body.toString(),
      },
    );


  const raw =
    await response.text();


  let payload:
    unknown = null;


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

    throw new Error(
      `HighLevel location token exchange failed (${response.status}): ` +
      `${typeof payload === "string"
        ? payload
        : JSON.stringify(payload)}`,
    );
  }


  if (
    typeof payload !== "object" ||
    payload === null
  ) {

    throw new Error(
      "HighLevel location token response was invalid.",
    );
  }


  const token =
    payload as Record<
      string,
      unknown
    >;


  if (
    typeof token.access_token !==
    "string"
  ) {

    throw new Error(
      "HighLevel location token response did not contain access_token.",
    );
  }


  return {
    access_token:
      token.access_token,

    token_type:
      typeof token.token_type === "string"
        ? token.token_type
        : "Bearer",

    expires_in:
      typeof token.expires_in === "number"
        ? token.expires_in
        : undefined,

    refresh_token:
      typeof token.refresh_token === "string"
        ? token.refresh_token
        : undefined,

    scope:
      typeof token.scope === "string"
        ? token.scope
        : undefined,

    userType:
      typeof token.userType === "string"
        ? token.userType
        : undefined,

    companyId:
      typeof token.companyId === "string"
        ? token.companyId
        : undefined,

    locationId:
      typeof token.locationId === "string"
        ? token.locationId
        : undefined,

    userId:
      typeof token.userId === "string"
        ? token.userId
        : undefined,

    appId:
      typeof token.appId === "string"
        ? token.appId
        : undefined,

    versionId:
      typeof token.versionId === "string"
        ? token.versionId
        : undefined,

    planId:
      typeof token.planId === "string"
        ? token.planId
        : undefined,
  };
}

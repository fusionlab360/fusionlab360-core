import {
  ApiError,
} from "../../../core/errors/ApiError";

import {
  logger,
} from "../../../core/logger";

import {
  GHL,
} from "./config";

import type {
  RequestContext,
} from "../../../context";

import type {
  IntegrationContext,
} from "../../../context/integration";


/*
 * --------------------------------------------------
 * GHL context
 * --------------------------------------------------
 */

type GHLIntegrationContext =
  | RequestContext
  | IntegrationContext;


/*
 * --------------------------------------------------
 * Extract API error message
 * --------------------------------------------------
 */

function extractErrorMessage(
  status:
    number,

  body:
    unknown,
): string {

  if (
    body &&
    typeof body ===
      "object" &&
    "message" in
      body &&
    typeof (
      body as {
        message?:
          unknown;
      }
    ).message ===
      "string"
  ) {

    return (
      body as {
        message:
          string;
      }
    ).message;
  }


  if (
    body &&
    typeof body ===
      "object" &&
    "error" in
      body &&
    typeof (
      body as {
        error?:
          unknown;
      }
    ).error ===
      "string"
  ) {

    return (
      body as {
        error:
          string;
      }
    ).error;
  }


  return (
    `GoHighLevel API request failed (${status})`
  );
}


/*
 * --------------------------------------------------
 * Resolve GHL provider
 * --------------------------------------------------
 */

function resolveGHLProvider(
  context:
    GHLIntegrationContext,
): string {

  /*
   * IntegrationContext has an explicit provider.
   */

  if (
    "provider" in
      context
  ) {

    return context.provider;
  }


  /*
   * RequestContext obtains the provider from
   * the tenant integration configuration.
   */

  return context
    .tenant
    .integrations
    .crm
    .provider;
}


/*
 * --------------------------------------------------
 * Resolve GHL resource
 * --------------------------------------------------
 *
 * For GoHighLevel the generic resourceId maps to
 * the location ID.
 */

function resolveGHLResourceId(
  context:
    GHLIntegrationContext,
): string |
  undefined {

  const locationId =
    context
      .tenant
      .integrations
      .crm
      .credentials
      .locationId
      ?.trim();


  return (
    locationId ||
    undefined
  );
}


/*
 * --------------------------------------------------
 * Parse GHL response
 * --------------------------------------------------
 */

async function parseGHLResponse(
  response:
    Response,
): Promise<unknown> {

  const raw =
    await response.text();


  if (!raw) {

    return null;
  }


  try {

    return JSON.parse(
      raw,
    );

  } catch {

    return raw;
  }
}


/*
 * --------------------------------------------------
 * Build request headers
 * --------------------------------------------------
 */

function buildGHLHeaders(
  accessToken:
    string,

  options:
    RequestInit,
): Headers {

  const headers =
    new Headers(
      options.headers,
    );


  headers.set(
    "Authorization",
    `Bearer ${accessToken}`,
  );


  headers.set(
    "Accept",
    "application/json",
  );


  /*
   * Preserve caller-supplied Version header when
   * present. Otherwise use the configured GHL version.
   */

  if (
    !headers.has(
      "Version",
    )
  ) {

    headers.set(
      "Version",
      GHL.API_VERSION,
    );
  }


  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has(
      "Content-Type",
    )
  ) {

    headers.set(
      "Content-Type",
      "application/json",
    );
  }


  return headers;
}


/*
 * --------------------------------------------------
 * Perform one GHL HTTP request
 * --------------------------------------------------
 */

async function performGHLRequest<T>(
  accessToken:
    string,

  endpoint:
    string,

  options:
    RequestInit = {},
): Promise<{
  response:
    Response;

  body:
    unknown;
}> {

  if (
    !accessToken?.trim()
  ) {

    throw new Error(
      "Missing GoHighLevel access token.",
    );
  }


  const url =
    `${GHL.BASE_URL}${endpoint}`;


  const method =
    options.method ??
    "GET";


  logger.debug(
    "Sending GHL request",
    {
      url,
      method,
    },
  );


  const response =
    await fetch(
      url,
      {
        ...options,

        headers:
          buildGHLHeaders(
            accessToken,
            options,
          ),
      },
    );


  const body =
    await parseGHLResponse(
      response,
    );


  logger.debug(
    "Received GHL response",
    {
      url,
      method,
      status:
        response.status,
    },
  );


  return {
    response,
    body,
  };
}


/*
 * --------------------------------------------------
 * Legacy GHL fetch
 * --------------------------------------------------
 *
 * Kept temporarily so existing providers continue
 * to compile while they are migrated to the runtime
 * credential path.
 */

export async function ghlFetch<T>(
  apiKey:
    string,

  endpoint:
    string,

  options:
    RequestInit = {},
): Promise<T> {

  if (
    !apiKey?.trim()
  ) {

    throw new Error(
      "Missing GoHighLevel API key.",
    );
  }


  const {
    response,
    body,
  } =
    await performGHLRequest<T>(
      apiKey,
      endpoint,
      options,
    );


  if (
    !response.ok
  ) {

    const message =
      extractErrorMessage(
        response.status,
        body,
      );


    logger.error(
      "GoHighLevel request failed",
      {
        url:
          `${GHL.BASE_URL}${endpoint}`,

        method:
          options.method ??
          "GET",

        status:
          response.status,

        response:
          body,
      },
    );


    throw new ApiError(
      response.status,
      message,
      body,
    );
  }


  logger.info(
    "GoHighLevel request completed",
    {
      url:
        `${GHL.BASE_URL}${endpoint}`,

      method:
        options.method ??
        "GET",

      status:
        response.status,
    },
  );


  return body as T;
}


/*
 * --------------------------------------------------
 * Runtime-aware authenticated GHL fetch
 * --------------------------------------------------
 *
 * Credential resolution is delegated to the generic
 * IntegrationRuntime.
 *
 * This supports:
 *
 * - api_key
 * - oauth2
 * - OAuth expiry refresh
 * - D1 refresh locking
 * - single retry after OAuth 401
 */

export async function ghlFetchAuthenticated<T>(
  context:
    GHLIntegrationContext,

  endpoint:
    string,

  options:
    RequestInit = {},
): Promise<T> {

  const provider =
    resolveGHLProvider(
      context,
    );


  if (
    provider !==
    "gohighlevel"
  ) {

    throw new Error(
      `GHL client received unsupported provider: ${provider}.`,
    );
  }


  const resourceId =
    resolveGHLResourceId(
      context,
    );


  const credentialRequest = {
    tenantId:
      context.tenant.id,

    provider:
      "gohighlevel",

    resourceId,
  };


  /*
   * ------------------------------------------------
   * 1. Resolve current credential
   * ------------------------------------------------
   */

  let credential =
    await context
      .integrationRuntime
      .credentials
      .resolve(
        credentialRequest,
      );


  /*
   * ------------------------------------------------
   * 2. Make initial request
   * ------------------------------------------------
   */

  let {
    response,
    body,
  } =
    await performGHLRequest<T>(
      credential.accessToken,
      endpoint,
      options,
    );


  /*
   * ------------------------------------------------
   * 3. OAuth 401 recovery
   * ------------------------------------------------
   *
   * API-key credentials do not enter this path.
   *
   * OAuth credentials force one token refresh and
   * then retry the original request exactly once.
   */

  if (
    response.status ===
      401 &&
    credential.authType ===
      "oauth2"
  ) {

    logger.warn(
      "GHL OAuth request returned 401; forcing credential refresh.",
      {
        endpoint,
        tenantId:
          context.tenant.id,
      },
    );


    credential =
      await context
        .integrationRuntime
        .credentials
        .resolve({
          ...credentialRequest,

          forceRefresh:
            true,
        });


    ({
      response,
      body,
    } =
      await performGHLRequest<T>(
        credential.accessToken,
        endpoint,
        options,
      ));
  }


  /*
   * ------------------------------------------------
   * 4. Handle final response
   * ------------------------------------------------
   */

  if (
    !response.ok
  ) {

    const message =
      extractErrorMessage(
        response.status,
        body,
      );


    logger.error(
      "GoHighLevel authenticated request failed",
      {
        url:
          `${GHL.BASE_URL}${endpoint}`,

        method:
          options.method ??
          "GET",

        status:
          response.status,

        response:
          body,

        tenantId:
          context.tenant.id,

        provider:
          provider,
      },
    );


    throw new ApiError(
      response.status,
      message,
      body,
    );
  }


  logger.info(
    "GoHighLevel authenticated request completed",
    {
      url:
        `${GHL.BASE_URL}${endpoint}`,

      method:
        options.method ??
        "GET",

      status:
        response.status,

      tenantId:
        context.tenant.id,

      provider:
        provider,

      authType:
        credential.authType,
    },
  );


  return body as T;
}
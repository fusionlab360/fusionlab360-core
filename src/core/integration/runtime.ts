/*
 * --------------------------------------------------
 * Integration Runtime
 * --------------------------------------------------
 *
 * Generic IPaaS infrastructure contract.
 *
 * This layer must remain provider-neutral.
 *
 * It knows that an integration may authenticate
 * using a static API key or OAuth2, but it does
 * not know anything about GHL, HubSpot, Salesforce,
 * Cloudbeds, etc.
 */


/*
 * --------------------------------------------------
 * Authentication type
 * --------------------------------------------------
 */

export type IntegrationAuthType =
  | "api_key"
  | "oauth2";


/*
 * --------------------------------------------------
 * Credential resolution request
 * --------------------------------------------------
 *
 * resourceId is intentionally generic.
 *
 * A provider may map it to:
 *
 * - location
 * - account
 * - property
 * - workspace
 * - site
 *
 * The core does not decide which.
 */

export interface IntegrationCredentialRequest {

  tenantId:
    string;

  provider:
    string;

  resourceId?:
    string;

  forceRefresh?:
    boolean;
}


/*
 * --------------------------------------------------
 * Resolved integration credential
 * --------------------------------------------------
 *
 * The runtime exposes only what the provider
 * actually needs to make an authenticated request.
 *
 * Refresh tokens remain inside the authentication
 * implementation and are never exposed to the
 * domain layer.
 */

export interface ResolvedIntegrationCredential {

  authType:
    IntegrationAuthType;

  accessToken:
    string;

  resourceId?:
    string | null;

  expiresAt?:
    number | null;
}


/*
 * --------------------------------------------------
 * Credential resolver
 * --------------------------------------------------
 */

export interface IntegrationCredentialResolver {

  resolve(
    request:
      IntegrationCredentialRequest,
  ):
    Promise<
      ResolvedIntegrationCredential
    >;
}


/*
 * --------------------------------------------------
 * Integration runtime
 * --------------------------------------------------
 *
 * Future generic capabilities can be added here.
 *
 * Examples:
 *
 * credentials
 * rateLimits
 * requestSigning
 * webhooks
 * etc.
 */

export interface IntegrationRuntime {

  credentials:
    IntegrationCredentialResolver;
}
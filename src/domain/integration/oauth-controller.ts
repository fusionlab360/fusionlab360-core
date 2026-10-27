import type {
  Context,
} from "hono";


import type {
  AppBindings,
  AppVariables,
} from "../../config/app";


import {
  exchangeGHLAuthorizationCode,
  buildGHLAuthorizationUrl,
  getGHLProviderErrorDiagnostics,
} from "../../integrations/messaging/gohighlevel/oauth";


import {
  syncGHLLocationCredential,
  completePendingGHLLocationOnboarding,
} from "../../integrations/messaging/gohighlevel/credential-sync";

import {
  CredentialRepository,
} from "../../persistence/repositories/credential-repository";

import {
  OAuthAuthorizationStateRepository,
} from "../../persistence/repositories/oauth-authorization-state-repository";

import {
  createOAuthStateToken,
  hashOAuthStateToken,
} from "../../core/security/oauth-state";

import {
  authenticate,
} from "../../core/security/authenticator";

import {
  resolveClientById,
} from "../../clients/resolver";

import type { APIClient } from "../../clients/types";
import type { AuthenticatedPrincipal } from "../../core/security/principal";

import {
  IntegrationRepository,
} from "../../persistence/repositories/integration-repository";

import type {
  GHLCompanyOAuthRuntimeEnvironment,
} from "../../integrations/messaging/gohighlevel/company-oauth-runtime";


import {
  OAuthInstallationRepository,
} from "../../persistence/repositories/oauth-installation-repository";


const OAUTH_ONBOARDING_PERMISSION = "integrations:oauth:connect";
const OAUTH_RECONNECT_PERMISSION = "integrations:test";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GM_METRO_TENANT_ID = "gmmetro";
const GM_METRO_LOCATION_ID = "Npx2IdDDRjXz2QW3Svx4";

interface GHLPendingContext {
  companyId: string;
  locationId: string;
  connectionStatus: string;
}

async function authenticateOAuthClient(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
): Promise<{ client: APIClient; principal: AuthenticatedPrincipal } | null> {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  try {
    const authenticated = await authenticate(
      c.env.DB,
      authorization.substring(7),
    );
    const principal = authenticated.principal;
    if (principal.type !== "client" || !principal.clientId) return null;

    const client = authenticated.client ?? await resolveClientById(
      c.env.DB,
      principal.clientId,
    );
    if (
      client.id !== principal.clientId ||
      client.tenantId !== principal.tenantId ||
      client.status !== "active"
    ) return null;

    return { client, principal };
  } catch {
    return null;
  }
}

function hasPermission(scopes: readonly string[], required: string): boolean {
  return scopes.includes("*") || scopes.includes(required);
}

function readGHLPendingContext(
  setup: {
    providerResourceId: string;
    credentialMetadata: string | null;
  },
): GHLPendingContext | null {
  if (!setup.credentialMetadata) {
    return null;
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(setup.credentialMetadata);
  } catch {
    return null;
  }

  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const companyId = record.companyId;
  const locationId = record.locationId;
  const connectionStatus = record.connectionStatus;

  if (
    record.accountType !== "location" ||
    typeof companyId !== "string" ||
    !companyId.trim() ||
    typeof locationId !== "string" ||
    locationId !== setup.providerResourceId ||
    typeof connectionStatus !== "string"
  ) {
    return null;
  }

  return {
    companyId: companyId.trim(),
    locationId,
    connectionStatus,
  };
}

/** Start OAuth only for the authenticated client's inactive pending tenant. */
export async function startGhlOAuthController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json(
      { success: false, message: "Unauthorized." },
      401,
    );
  }

  let authenticated;
  try {
    authenticated = await authenticate(
      c.env.DB,
      authorization.substring(7),
    );
  } catch {
    return c.json(
      { success: false, message: "Unauthorized." },
      401,
    );
  }

  const principal = authenticated.principal;
  if (principal.type !== "client" || !principal.clientId) {
    return c.json(
      { success: false, message: "Unauthorized." },
      401,
    );
  }

  let client;
  try {
    client = authenticated.client ?? await resolveClientById(
      c.env.DB,
      principal.clientId,
    );
  } catch {
    return c.json(
      { success: false, message: "Unauthorized." },
      401,
    );
  }

  if (
    client.id !== principal.clientId ||
    client.tenantId !== principal.tenantId
  ) {
    return c.json(
      { success: false, message: "Unauthorized." },
      401,
    );
  }

  if (
    !client.permissions.includes(OAUTH_ONBOARDING_PERMISSION) ||
    !principal.permissions.includes(OAUTH_ONBOARDING_PERMISSION)
  ) {
    return c.json(
      { success: false, message: "Insufficient permissions." },
      403,
    );
  }

  try {
    const integrationRepository =
      new IntegrationRepository(c.env.DB);
    const setup = await integrationRepository.findOAuthOnboardingSetup(
      principal.tenantId,
      "gohighlevel",
    );

    if (
      !setup ||
      setup.tenantStatus !== "inactive" ||
      setup.provider !== "gohighlevel" ||
      setup.credentialAuthType !== "oauth2"
    ) {
      return c.json(
        { success: false, message: "No eligible pending OAuth integration was found." },
        409,
      );
    }

    const pendingContext = readGHLPendingContext(setup);
    if (!pendingContext) {
      return c.json(
        { success: false, message: "The pending OAuth configuration is invalid." },
        409,
      );
    }

    await new CredentialRepository(c.env.DB).assertLocationOwnership(
      principal.tenantId,
      "gohighlevel",
      pendingContext.locationId,
    );

    if (setup.credentialHasToken) {
      if (
        !["pending_oauth", "connected"].includes(
          pendingContext.connectionStatus,
        )
      ) {
        return c.json(
          { success: false, message: "The OAuth credential is not eligible for activation recovery." },
          409,
        );
      }

      await completePendingGHLLocationOnboarding(
        c.env.DB,
        principal.tenantId,
        pendingContext.companyId,
        pendingContext.locationId,
      );

      return c.json({
        success: true,
        status: "activation_recovered",
      });
    }

    if (
      setup.integrationEnabled ||
      pendingContext.connectionStatus !== "pending_oauth"
    ) {
      return c.json(
        { success: false, message: "The pending OAuth integration is not eligible for authorization." },
        409,
      );
    }

    const rawState = createOAuthStateToken();
    const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
    const authorizationUrl = buildGHLAuthorizationUrl(
      {
        GHL_OAUTH_CLIENT_ID: c.env.GHL_OAUTH_CLIENT_ID,
        GHL_OAUTH_REDIRECT_URI: c.env.GHL_OAUTH_REDIRECT_URI,
        GHL_OAUTH_SCOPES: c.env.GHL_OAUTH_SCOPES,
      },
      rawState,
    );

    await new OAuthAuthorizationStateRepository(c.env.DB).create({
      stateHash: await hashOAuthStateToken(rawState),
      tenantId: principal.tenantId,
      integrationId: setup.integrationId,
      provider: setup.provider,
      purpose: "connect",
      context: {
        companyId: pendingContext.companyId,
        locationId: pendingContext.locationId,
      },
      expiresAt,
    });

    return c.json({
      success: true,
      authorizationUrl,
      expiresAt,
    });
  } catch (error: unknown) {
    console.error("OAuth initiation failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json(
      { success: false, message: "OAuth authorization is not configured or could not be started." },
      503,
    );
  }
}

/** Start a browser reconnect for the single explicitly approved pilot tenant. */
export async function startGhlReconnectController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  const authenticated = await authenticateOAuthClient(c);
  if (!authenticated) {
    return c.json({ success: false, message: "Unauthorized." }, 401);
  }

  const { client, principal } = authenticated;
  if (
    !hasPermission(client.permissions, OAUTH_ONBOARDING_PERMISSION) ||
    !hasPermission(principal.permissions, OAUTH_ONBOARDING_PERMISSION) ||
    !hasPermission(client.permissions, OAUTH_RECONNECT_PERMISSION) ||
    !hasPermission(principal.permissions, OAUTH_RECONNECT_PERMISSION)
  ) {
    return c.json({ success: false, message: "Insufficient permissions." }, 403);
  }

  if (principal.tenantId !== GM_METRO_TENANT_ID) {
    return c.json({ success: false, message: "OAuth reconnect is unavailable for this tenant." }, 403);
  }

  try {
    const setup = await new IntegrationRepository(c.env.DB)
      .findOAuthOnboardingSetup(principal.tenantId, "gohighlevel");
    const pendingContext = setup ? readGHLPendingContext(setup) : null;

    if (
      !setup ||
      !pendingContext ||
      setup.tenantStatus !== "active" ||
      setup.provider !== "gohighlevel" ||
      !setup.integrationEnabled ||
      setup.credentialAuthType !== "oauth2" ||
      !setup.credentialHasToken ||
      pendingContext.connectionStatus !== "connected" ||
      pendingContext.locationId !== GM_METRO_LOCATION_ID
    ) {
      return c.json({ success: false, message: "No eligible OAuth integration was found." }, 409);
    }

    const credentialRepository = new CredentialRepository(c.env.DB);
    const owner = await credentialRepository.findTenantIdByProviderAndLocation(
      "gohighlevel",
      GM_METRO_LOCATION_ID,
    );
    if (owner !== GM_METRO_TENANT_ID) {
      return c.json({ success: false, message: "The configured GHL Location is not owned by this tenant." }, 409);
    }

    const rawState = createOAuthStateToken();
    const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
    const authorizationUrl = buildGHLAuthorizationUrl(
      {
        GHL_OAUTH_CLIENT_ID: c.env.GHL_OAUTH_CLIENT_ID,
        GHL_OAUTH_REDIRECT_URI: c.env.GHL_OAUTH_REDIRECT_URI,
        GHL_OAUTH_SCOPES: c.env.GHL_OAUTH_SCOPES,
      },
      rawState,
    );

    await new OAuthAuthorizationStateRepository(c.env.DB).create({
      stateHash: await hashOAuthStateToken(rawState),
      tenantId: GM_METRO_TENANT_ID,
      integrationId: setup.integrationId,
      provider: "gohighlevel",
      purpose: "reconnect",
      context: {
        companyId: pendingContext.companyId,
        locationId: GM_METRO_LOCATION_ID,
      },
      expiresAt,
    });

    return c.json({ success: true, authorizationUrl, expiresAt });
  } catch (error: unknown) {
    console.error("OAuth reconnect initiation failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return c.json(
      { success: false, message: "OAuth reconnect is not configured or could not be started." },
      503,
    );
  }
}


export async function ghlOAuthCallbackController(
  c: Context<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>,
) {
  try {
    // 1. Require and consume one-time state before processing
    // provider errors or exchanging an authorization code.
    const rawState = c.req.query("state");

    if (!rawState?.trim()) {
      return c.json(
        {
          success: false,
          message: "Missing OAuth state.",
        },
        400,
      );
    }

    const stateRepository =
      new OAuthAuthorizationStateRepository(c.env.DB);

    const stateHash =
      await hashOAuthStateToken(rawState);

    const authorizationState =
      await stateRepository.consume(stateHash);

    const isReconnect = authorizationState?.purpose === "reconnect";
    if (
      !authorizationState ||
      authorizationState.provider !== "gohighlevel" ||
      (authorizationState.purpose !== "connect" && !isReconnect)
    ) {
      return c.json(
        {
          success: false,
          message:
            "OAuth state is invalid, expired, already used, or no longer matches its integration.",
        },
        400,
      );
    }

    // 2. Read the expected provider account context from the
    // server-stored state. Never accept these IDs from callback
    // query parameters.
    const expectedCompanyId =
      authorizationState.context.companyId;

    const expectedLocationId =
      authorizationState.context.locationId;

    if (
      typeof expectedCompanyId !== "string" ||
      !expectedCompanyId.trim() ||
      typeof expectedLocationId !== "string" ||
      !expectedLocationId.trim()
    ) {
      return c.json(
        {
          success: false,
          message:
            "OAuth state is missing its expected provider account context.",
        },
        400,
      );
    }

    // A denied authorization still consumes its state.
    const providerError = c.req.query("error");

    if (providerError) {
      return c.json(
        {
          success: false,
          message:
            "HighLevel authorization was not completed. Start a new authorization attempt.",
        },
        400,
      );
    }

    const code = c.req.query("code");

    if (!code?.trim()) {
      return c.json(
        {
          success: false,
          message:
            "Missing HighLevel authorization code.",
        },
        400,
      );
    }

    const pendingSetup =
      await new IntegrationRepository(c.env.DB).findOAuthOnboardingSetup(
        authorizationState.tenantId,
        "gohighlevel",
      );
    const pendingContext = pendingSetup
      ? readGHLPendingContext(pendingSetup)
      : null;

    const setupMatches = isReconnect
      ? Boolean(
        pendingSetup &&
        pendingContext &&
        pendingSetup.tenantStatus === "active" &&
        pendingSetup.integrationId === authorizationState.integrationId &&
        pendingSetup.provider === authorizationState.provider &&
        pendingSetup.integrationEnabled &&
        pendingSetup.credentialAuthType === "oauth2" &&
        pendingSetup.credentialHasToken &&
        pendingContext.connectionStatus === "connected" &&
        pendingContext.companyId === expectedCompanyId &&
        pendingContext.locationId === expectedLocationId &&
        authorizationState.tenantId === GM_METRO_TENANT_ID &&
        expectedLocationId === GM_METRO_LOCATION_ID
      )
      : Boolean(
        pendingSetup &&
        pendingContext &&
        pendingSetup.tenantStatus === "inactive" &&
        pendingSetup.integrationId === authorizationState.integrationId &&
        pendingSetup.provider === authorizationState.provider &&
        !pendingSetup.integrationEnabled &&
        pendingSetup.credentialAuthType === "oauth2" &&
        !pendingSetup.credentialHasToken &&
        pendingContext.connectionStatus === "pending_oauth" &&
        pendingContext.companyId === expectedCompanyId &&
        pendingContext.locationId === expectedLocationId
      );

    if (!setupMatches) {
      return c.json(
        {
          success: false,
          message:
            "The pending integration no longer matches this OAuth authorization attempt.",
        },
        409,
      );
    }

    const oauthEnvironment:
      GHLCompanyOAuthRuntimeEnvironment = {
        GHL_OAUTH_CLIENT_ID:
          c.env.GHL_OAUTH_CLIENT_ID,

        GHL_OAUTH_CLIENT_SECRET:
          c.env.GHL_OAUTH_CLIENT_SECRET,

        GHL_OAUTH_REDIRECT_URI:
          c.env.GHL_OAUTH_REDIRECT_URI,
      };

    // 3. Exchange the code only after state validation.
    const token = await exchangeGHLAuthorizationCode(
      oauthEnvironment,
      code,
    );

    const companyId = token.companyId?.trim();

    if (
      !companyId ||
      companyId !== expectedCompanyId ||
      (
        token.userType !== undefined &&
        token.userType !== "Company"
      )
    ) {
      return c.json(
        {
          success: false,
          message:
            "The authorized Company does not match the Company bound to this OAuth attempt.",
        },
        409,
      );
    }

    // If HighLevel supplies an approved Location list, ensure
    // the requested Location is included.
    const approvedLocations =
      token.approvedLocations ?? [];

    if (
      approvedLocations.length > 0 &&
      !approvedLocations.includes(expectedLocationId)
    ) {
      return c.json(
        {
          success: false,
          message:
            "The requested Location was not included in the authorization grant.",
        },
        409,
      );
    }

    // 4. Ensure this Location maps to the tenant bound to the
    // consumed state before writing provider tokens.
    const credentialRepository =
      new CredentialRepository(c.env.DB);

    const mappedTenantId =
      await credentialRepository.findTenantIdByProviderAndLocation(
        "gohighlevel",
        expectedLocationId,
      );

    if (
      !mappedTenantId ||
      mappedTenantId !== authorizationState.tenantId
    ) {
      return c.json(
        {
          success: false,
          message:
            "The authorized Location does not map to the tenant that initiated this OAuth attempt.",
        },
        409,
      );
    }

    // 5. Persist the Company installation after state,
    // Company and Location validation.
    const accessTokenExpiresAt =
      typeof token.expires_in === "number"
        ? Date.now() + token.expires_in * 1000
        : null;

    const metadata = JSON.stringify({
      userType: token.userType ?? "Company",
      scope: token.scope ?? null,
      expiresIn: token.expires_in ?? null,
      isBulkInstallation:
        token.isBulkInstallation ?? false,
      approvedLocations,
      installToFutureLocations:
        token.installToFutureLocations ?? false,
      approveAllLocations:
        token.approveAllLocations ?? false,
    });

    const installationRepository =
      new OAuthInstallationRepository(c.env.DB);

    const installation = {
      provider: "gohighlevel",
      accountType: "company",
      externalAccountId: companyId,
      externalUserId: token.userId ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      accessTokenExpiresAt,
      refreshLockToken: null,
      refreshLockExpiresAt: null,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const;

    if (isReconnect) {
      await installationRepository.upsert(installation);
    } else {
      await installationRepository.createIfAbsent(installation);
    }

    // 6. Sync only the Location bound to the consumed state.
    // This deliberately does not call the company-wide sync.
    const locationCredentialSync =
      await syncGHLLocationCredential(
        c.env.DB,
        oauthEnvironment,
        companyId,
        expectedLocationId,
        {
          userId: token.userId,
        },
        {
          expectedTenantId: authorizationState.tenantId,
          companyAccessToken: token.access_token,
        },
      );

    if (
      locationCredentialSync.tenantId !==
      authorizationState.tenantId
    ) {
      // The mapping was checked before sync; treat any
      // unexpected result as a failed onboarding operation.
      console.error(
        "OAuth Location sync returned an unexpected tenant mapping.",
      );

      return c.json(
        {
          success: false,
          message:
            "OAuth credential synchronization returned an unexpected tenant mapping.",
        },
        409,
      );
    }

    if (!locationCredentialSync.success) {
      return c.json(
        {
          success: false,
          companyAuthorizationSuccess: true,
          locationSyncSuccess: false,
          credentialSyncStatus:
            locationCredentialSync.credentialSyncStatus,
          tenantId: locationCredentialSync.tenantId,
          companyId,
          locationId: expectedLocationId,
          message:
            "Company authorization succeeded, but the Location credential was not stored. Any existing legacy PIT credential was preserved.",
        },
        409,
      );
    }

    return c.json({
      success: true,
      companyAuthorizationSuccess: true,
      locationSyncSuccess: true,
      credentialSyncStatus:
        locationCredentialSync.credentialSyncStatus,
      tenantId: locationCredentialSync.tenantId,
      companyId,
      locationId: expectedLocationId,
      message:
        "OAuth authorization succeeded and the selected Location credential was stored.",
    });
  } catch (error: unknown) {
    console.error(
      "HighLevel OAuth callback failed.",
      getGHLProviderErrorDiagnostics(error),
    );

    return c.json(
      {
        success: false,
        message: "HighLevel OAuth callback failed.",
      },
      500,
    );
  }
}

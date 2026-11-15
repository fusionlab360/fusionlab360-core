
import {
  createMiddleware,
} from "hono/factory";

import {
  createRequestContext,
} from "../context";

import {
  resolveTenant,
} from "../tenants/service";

import {
  authenticate,
} from "../core/security/authenticator";
import { resolveClientById } from "../clients/resolver";

import type {
  AuthenticationResult,
} from "./providers/types";

import {
  createIntegrationRuntime,
} from "../application/integration/runtime";

export const authMiddleware =
  createMiddleware(
    async (
      c,
      next,
    ) => {
      const diagnostics = c.get("diagnostics");
      diagnostics?.emit("auth", "started");
      let stage = "read_authorization";

      try {
        const authorization =
          c.req.header("Authorization");

        if (
          !authorization?.startsWith("Bearer ")
        ) {
          throw new Error(
            "Missing authorization token.",
          );
        }

        const credential =
          authorization.substring(7);

        stage = "authenticate_credential";

        const authentication: AuthenticationResult =
          await authenticate(
            c.env.DB,
            credential,
          );

        stage = "resolve_client";
        const authenticatedClient = authentication.client ??
          await resolveClientById(
            c.env.DB,
            authentication.principal.clientId ?? "",
          );

        stage = "validate_authenticated_principal";
        if (
          !authentication.principal.clientId ||
          authenticatedClient.id !== authentication.principal.clientId ||
          authenticatedClient.tenantId !== authentication.principal.tenantId
        ) {
          throw new Error("Authenticated principal does not match its client.");
        }

        diagnostics?.emit("auth", "succeeded", undefined, {
          authenticationType: credential.startsWith("fl360_") ? "api_key" : "jwt",
        });
        stage = "resolve_tenant";
        diagnostics?.emit("tenant", "started");

        const tenant =
          await resolveTenant(
            c.env.DB,
            authenticatedClient.tenantId,
          );

        diagnostics?.emit("tenant", "succeeded");
        stage = "create_integration_runtime";

        const integrationRuntime =
          createIntegrationRuntime(
            tenant.integrations.crm.provider,
            {
              DB: c.env.DB,
              diagnostics,

              GHL_OAUTH_CLIENT_ID:
                c.env.GHL_OAUTH_CLIENT_ID,

              GHL_OAUTH_CLIENT_SECRET:
                c.env.GHL_OAUTH_CLIENT_SECRET,

              GHL_OAUTH_REDIRECT_URI:
                c.env.GHL_OAUTH_REDIRECT_URI,

              CORE_CREDENTIAL_ENCRYPTION_KEYS:
                c.env.CORE_CREDENTIAL_ENCRYPTION_KEYS,

              CORE_CREDENTIAL_ACTIVE_KEY_VERSION:
                c.env.CORE_CREDENTIAL_ACTIVE_KEY_VERSION,

              CORE_CREDENTIAL_LEGACY_READS_ENABLED:
                c.env.CORE_CREDENTIAL_LEGACY_READS_ENABLED,
            },
          );

        stage = "create_request_context";

        const context =
          createRequestContext(
            authenticatedClient,
            tenant,
            integrationRuntime,
            diagnostics?.correlationId,
          );

        c.set("context", context);
        c.set("principal", authentication.principal);
      } catch (error: unknown) {
        if (stage === "resolve_tenant") {
          diagnostics?.emit("tenant", "failed", "TENANT_RESOLUTION_FAILED");
        } else if (!["create_integration_runtime", "create_request_context"].includes(stage)) {
          diagnostics?.emit("auth", "failed", "AUTH_FAILURE");
        }

        if ([
          "read_authorization",
          "authenticate_credential",
          "resolve_client",
          "validate_authenticated_principal",
        ].includes(stage)) {
          return c.json(
            { success: false, message: "Unauthorized." },
            401,
          );
        }

        throw error;
      }

      await next();
    },
  );


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

        stage = "resolve_tenant";

        const tenant =
          await resolveTenant(
            c.env.DB,
            authenticatedClient.tenantId,
          );

        stage = "create_integration_runtime";

        const integrationRuntime =
          createIntegrationRuntime(
            tenant.integrations.crm.provider,
            {
              DB: c.env.DB,

              GHL_OAUTH_CLIENT_ID:
                c.env.GHL_OAUTH_CLIENT_ID,

              GHL_OAUTH_CLIENT_SECRET:
                c.env.GHL_OAUTH_CLIENT_SECRET,

              GHL_OAUTH_REDIRECT_URI:
                c.env.GHL_OAUTH_REDIRECT_URI,
            },
          );

        stage = "create_request_context";

        const context =
          createRequestContext(
            authenticatedClient,
            tenant,
            integrationRuntime,
          );

        c.set("context", context);
        c.set("principal", authentication.principal);
      } catch (error: unknown) {
        console.error(
          "Authentication middleware failed.",
          {
            stage,
            errorName:
              error instanceof Error
                ? error.name
                : "UnknownError",
          },
        );

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

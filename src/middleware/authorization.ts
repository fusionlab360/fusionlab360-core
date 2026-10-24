import { createMiddleware } from "hono/factory";
import type { AppBindings, AppVariables } from "../config/app";
import type { PermissionScope } from "../clients/permissions";
import type { APIClient } from "../clients/types";
import type { AuthenticatedPrincipal } from "../core/security/principal";
import { authenticate } from "../core/security/authenticator";
import { resolveClientById } from "../clients/resolver";
import { TenantRepository } from "../persistence/repositories/tenant-repository";

function permits(scopes: readonly string[], required: string): boolean {
  return scopes.includes("*") || scopes.includes(required);
}

/** Require a named permission from both the authenticated client and principal. */
export function requirePermission(permission: PermissionScope) {
  return createMiddleware<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>(async (c, next) => {
    const context = c.get("context");
    const principal = c.get("principal");

    if (!context || !principal) {
      return c.json(
        { success: false, message: "Unauthorized." },
        401,
      );
    }

    if (
      context.client.id !== principal.clientId ||
      context.client.tenantId !== context.tenant.id ||
      principal.tenantId !== context.tenant.id
    ) {
      return c.json(
        { success: false, message: "Unauthorized." },
        401,
      );
    }

    if (
      !permits(context.client.permissions, permission) ||
      !permits(principal.permissions, permission)
    ) {
      return c.json(
        { success: false, message: "Insufficient permissions." },
        403,
      );
    }

    await next();
  });
}

/**
 * Authorize a tenant-owned API operation without constructing the legacy
 * CRM-dependent RequestContext. Use only for integration management paths
 * whose provider does not depend on the tenant's CRM integration.
 */
export function requireTenantClientPermission(permission: PermissionScope) {
  return createMiddleware<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>(async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return c.json(
        { success: false, message: "Unauthorized." },
        401,
      );
    }

    let authenticated: { client: APIClient; principal: AuthenticatedPrincipal };
    try {
      const result = await authenticate(
        c.env.DB,
        authorization.substring(7),
      );
      const principal = result.principal;
      if (principal.type !== "client" || !principal.clientId) {
        return c.json(
          { success: false, message: "Unauthorized." },
          401,
        );
      }
      const client = result.client ?? await resolveClientById(c.env.DB, principal.clientId);
      if (
        client.id !== principal.clientId ||
        client.tenantId !== principal.tenantId ||
        client.status !== "active"
      ) {
        return c.json(
          { success: false, message: "Unauthorized." },
          401,
        );
      }
      authenticated = { client, principal };
    } catch {
      return c.json(
        { success: false, message: "Unauthorized." },
        401,
      );
    }

    const { client, principal } = authenticated;
    if (
      !permits(client.permissions, permission) ||
      !permits(principal.permissions, permission)
    ) {
      return c.json(
        { success: false, message: "Insufficient permissions." },
        403,
      );
    }

    try {
      const tenant = await new TenantRepository(c.env.DB).findById(client.tenantId);
      if (!tenant || tenant.id !== principal.tenantId || tenant.status !== "active") {
        return c.json(
          { success: false, message: "Tenant is unavailable." },
          403,
        );
      }
    } catch {
      return c.json(
        { success: false, message: "Tenant authorization is temporarily unavailable." },
        503,
      );
    }

    c.set("principal", principal);
    await next();
  });
}

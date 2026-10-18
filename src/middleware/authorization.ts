import { createMiddleware } from "hono/factory";
import type { AppBindings, AppVariables } from "../config/app";
import type { PermissionScope } from "../clients/permissions";

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

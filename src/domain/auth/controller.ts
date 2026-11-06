import type { Context } from "hono";
import type { AuthenticatedPrincipal } from "../../core/security/principal";
import { authService } from "./service";
import { LoginSchema, RefreshSchema } from "./schemas";

export async function login(c: Context) {
  const body = await c.req.json();
  const request = LoginSchema.parse(body);

  const response = await authService.login(request);

  return c.json(response);
}

export async function refresh(c: Context) {
  const body = await c.req.json();
  const request = RefreshSchema.parse(body);

  const response = await authService.refresh(request);

  return c.json(response);
}

export async function logout(c: Context) {
  await authService.logout();

  return c.json({
    success: true,
  });
}

export async function me(c: Context) {
  const principal = c.get("principal") as AuthenticatedPrincipal | undefined;

  if (
    principal?.type !== "user" ||
    !principal.userId ||
    !principal.clientId ||
    !principal.role
  ) {
    return c.json({ success: false, message: "Forbidden." }, 403);
  }

  return c.json({
    id: principal.userId,
    tenantId: principal.tenantId,
    clientId: principal.clientId,
    role: principal.role,
    permissions: [...principal.permissions],
  });
}

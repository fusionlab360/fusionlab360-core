import type { Context } from "hono";
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
  const context = c.get("context");

  const user = await authService.currentUser(
    context.userId,
  );

  return c.json(user);
}
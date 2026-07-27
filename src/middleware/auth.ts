import { createMiddleware } from "hono/factory";

import { createRequestContext } from "../context";
import { resolveTenant } from "../tenants/service";

import { authenticate } from "../core/security/authenticator";

import type { AuthenticationResult } from "./providers/types";

export const authMiddleware = createMiddleware(async (c, next) => {
  const authorization = c.req.header("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }

  const credential = authorization.substring(7);

  const authentication: AuthenticationResult =
    await authenticate(
      c.env.DB,
      credential,
    );

  const tenant = await resolveTenant(
    c.env.DB,
    authentication.principal.tenantId,
  );

  const context = createRequestContext(
    authentication.client!,
    tenant,
  );

  c.set("context", context);

  await next();
});
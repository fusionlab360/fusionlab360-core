import { verifyAccessToken } from "../../core/security/jwt";

import type { AuthenticationResult } from "./types";

export async function authenticateJwt(
  token: string,
): Promise<AuthenticationResult> {

  const claims = await verifyAccessToken(token);

  return {
    principal: {
      type: "user",

      tenantId: claims.tenantId,

      clientId: claims.clientId,

      userId: claims.userId,

      role: claims.role,

      permissions: claims.permissions ?? [],
    },
  };
}
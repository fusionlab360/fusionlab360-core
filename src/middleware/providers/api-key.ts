import { resolveClient } from "../../clients/resolver";

import { hashApiKey } from "../../core/security/api-key";

import type { AuthenticationResult } from "./types";

export async function authenticateApiKey(
  db: D1Database,
  apiKey: string,
): Promise<AuthenticationResult> {

  const apiKeyHash = await hashApiKey(apiKey);

  const client = await resolveClient(
    db,
    apiKeyHash,
  );

  return {
    client,

    principal: {
      type: "client",

      tenantId: client.tenantId,

      clientId: client.id,

      permissions: client.permissions,
    },
  };
}
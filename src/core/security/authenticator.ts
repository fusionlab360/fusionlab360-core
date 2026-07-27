import { authenticateApiKey } from "../../middleware/providers/api-key";
import { authenticateJwt } from "../../middleware/providers/jwt";

import type { AuthenticationResult } from "../../middleware/providers/types";

export async function authenticate(
  db: D1Database,
  credential: string,
): Promise<AuthenticationResult> {

  if (credential.startsWith("fl360_")) {
    return authenticateApiKey(
      db,
      credential,
    );
  }

  return authenticateJwt(credential);
}
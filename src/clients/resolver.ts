
import { authenticateClient } from "./service";
import type { APIClient } from "./types";

export async function resolveClient(
  db: D1Database,
  apiKeyHash: string,
): Promise<APIClient> {
  return authenticateClient(
    db,
    apiKeyHash,
  );
}
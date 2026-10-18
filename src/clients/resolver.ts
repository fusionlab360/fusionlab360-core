
import { authenticateClient, resolveActiveClientById } from "./service";
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

export async function resolveClientById(
  db: D1Database,
  clientId: string,
): Promise<APIClient> {
  return resolveActiveClientById(db, clientId);
}

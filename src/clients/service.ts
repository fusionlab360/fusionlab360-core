
import { ClientRepository } from "../persistence/repositories/client-repository";
import { mapClient } from "./mapper";

import type { APIClient } from "./types";

export async function authenticateClient(
  db: D1Database,
  apiKeyHash: string,
): Promise<APIClient> {

  const repository = new ClientRepository(db);

  const record = await repository.findByApiKeyHash(
    apiKeyHash,
  );

  if (!record) {
    throw new Error("Invalid API client.");
  }

  const client = mapClient(record);

  if (client.status !== "active") {
    throw new Error("API client is inactive.");
  }

  return client;
}
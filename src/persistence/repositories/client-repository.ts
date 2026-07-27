import { BaseRepository } from "./base-repository";
import type { ClientRecord } from "../models/client";

export class ClientRepository extends BaseRepository {
  async findById(
    id: string,
  ): Promise<ClientRecord | undefined> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM clients
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(id)
      .first<ClientRecord>();

    return result ?? undefined;
  }

  async findByApiKeyHash(
    apiKeyHash: string,
  ): Promise<ClientRecord | undefined> {
    const result = await this.db
      .prepare(
        `
        SELECT *
        FROM clients
        WHERE api_key_hash = ?
        LIMIT 1
        `,
      )
      .bind(apiKeyHash)
      .first<ClientRecord>();

    return result ?? undefined;
  }
}
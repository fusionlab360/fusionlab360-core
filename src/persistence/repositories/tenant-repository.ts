import { BaseRepository } from "./base-repository";
import type { TenantRecord } from "../models/tenant";

export class TenantRepository extends BaseRepository {
  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.db
      .prepare(
        `
        SELECT *
        FROM tenants
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(id)
      .first();

    if (!row) {
      return null;
    }

    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as "active" | "inactive",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
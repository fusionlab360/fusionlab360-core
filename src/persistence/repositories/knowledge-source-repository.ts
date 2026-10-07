import {
  BaseRepository,
} from "./base-repository";

import type {
  KnowledgeSourceRecord,
} from "../models/knowledge-source";


export class KnowledgeSourceRepository
  extends BaseRepository {


  async findByTenant(
    tenantId:
      string,
  ): Promise<
    KnowledgeSourceRecord[]
  > {

    const {
      results,
    } =
      await this.db
        .prepare(
          `
          SELECT *
          FROM knowledge_sources
          WHERE tenant_id = ?
          ORDER BY name ASC
          `,
        )
        .bind(
          tenantId,
        )
        .all();


    return (
      results ?? []
    ).map(
      (
        row,
      ) =>
        this.mapRow(
          row,
        ),
    );
  }


  async findByTenantProviderSource(
    tenantId:
      string,

    provider:
      string,

    providerSourceId:
      string,
  ): Promise<
    KnowledgeSourceRecord | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM knowledge_sources
          WHERE tenant_id = ?
            AND provider = ?
            AND provider_source_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          providerSourceId,
        )
        .first();


    if (!result) {
      return null;
    }


    return this.mapRow(
      result,
    );
  }


  async upsert(
    source:
      KnowledgeSourceRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO knowledge_sources (
          id,
          tenant_id,
          provider,
          provider_source_id,
          name,
          description,
          metadata,
          raw_payload,
          source_created_at,
          source_updated_at,
          synced_at,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          tenant_id,
          provider,
          provider_source_id
        )
        DO UPDATE SET

          id =
            excluded.id,

          name =
            excluded.name,

          description =
            excluded.description,

          metadata =
            excluded.metadata,

          raw_payload =
            excluded.raw_payload,

          source_created_at =
            excluded.source_created_at,

          source_updated_at =
            excluded.source_updated_at,

          synced_at =
            excluded.synced_at,

          status =
            excluded.status,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(
        source.id,
        source.tenantId,
        source.provider,
        source.providerSourceId,
        source.name,
        source.description,
        source.metadata,
        source.rawPayload,
        source.sourceCreatedAt,
        source.sourceUpdatedAt,
        source.syncedAt,
        source.status,
      )
      .run();
  }


  async markDeleted(
    tenantId:
      string,

    provider:
      string,

    providerSourceId:
      string,

    syncedAt:
      string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE knowledge_sources
        SET
          status = 'deleted',
          synced_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND provider = ?
          AND provider_source_id = ?
        `,
      )
      .bind(
        syncedAt,
        tenantId,
        provider,
        providerSourceId,
      )
      .run();
  }


  private mapRow(
    row:
      Record<
        string,
        unknown
      >,
  ):
    KnowledgeSourceRecord {

    return {

      id:
        row.id as string,

      tenantId:
        row.tenant_id as string,

      provider:
        row.provider as string,

      providerSourceId:
        row.provider_source_id as string,

      name:
        row.name as string,

      description:
        row.description as
          string | null,

      metadata:
        row.metadata as
          string | null,

      rawPayload:
        row.raw_payload as
          string | null,

      sourceCreatedAt:
        row.source_created_at as
          string | null,

      sourceUpdatedAt:
        row.source_updated_at as
          string | null,

      syncedAt:
        row.synced_at as
          string | null,

      status:
        row.status as
          "active" |
          "deleted",

      createdAt:
        row.created_at as string,

      updatedAt:
        row.updated_at as string,
    };
  }

  async findById(
  id:
    string,
):
  Promise<
    KnowledgeSourceRecord | null
  > {

  const result =
    await this.db
      .prepare(
        `
        SELECT *
        FROM knowledge_sources
        WHERE id = ?
        LIMIT 1
        `,
      )
      .bind(
        id,
      )
      .first();


  if (!result) {

    return null;
  }


  return this.mapRow(
    result,
  );
}

  async findByTenantProviderName(
  tenantId:
    string,

  provider:
    string,

  name:
    string,
): Promise<
  KnowledgeSourceRecord[]
> {

  const {
    results,
  } =
    await this.db
      .prepare(
        `
        SELECT *
        FROM knowledge_sources
        WHERE tenant_id = ?
          AND provider = ?
          AND name = ?
          AND status = 'active'
        ORDER BY updated_at DESC
        `,
      )
      .bind(
        tenantId,
        provider,
        name,
      )
      .all();


  return (
    results ?? []
  ).map(
    (
      row,
    ) =>
      this.mapRow(
        row,
      ),
  );
}
}


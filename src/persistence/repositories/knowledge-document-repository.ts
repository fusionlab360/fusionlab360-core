import {
  BaseRepository,
} from "./base-repository";

import type {
  KnowledgeDocumentRecord,
} from "../models/knowledge-document";


export class KnowledgeDocumentRepository
  extends BaseRepository {


  async findByTenant(
    tenantId:
      string,
  ): Promise<
    KnowledgeDocumentRecord[]
  > {

    const {
      results,
    } =
      await this.db
        .prepare(
          `
          SELECT *
          FROM knowledge_documents
          WHERE tenant_id = ?
          ORDER BY updated_at DESC
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


  async findBySource(
    knowledgeSourceId:
      string,
  ): Promise<
    KnowledgeDocumentRecord[]
  > {

    const {
      results,
    } =
      await this.db
        .prepare(
          `
          SELECT *
          FROM knowledge_documents
          WHERE knowledge_source_id = ?
          ORDER BY updated_at DESC
          `,
        )
        .bind(
          knowledgeSourceId,
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


  async findByTenantProviderDocument(
    tenantId:
      string,

    provider:
      string,

    sourceType:
      string,

    providerDocumentId:
      string,
  ): Promise<
    KnowledgeDocumentRecord | null
  > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM knowledge_documents
          WHERE tenant_id = ?
            AND provider = ?
            AND source_type = ?
            AND provider_document_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          sourceType,
          providerDocumentId,
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
    document:
      KnowledgeDocumentRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO knowledge_documents (
          id,
          tenant_id,
          provider,
          knowledge_source_id,
          provider_document_id,
          source_type,
          title,
          content,
          source_url,
          mime_type,
          metadata,
          raw_payload,
          content_hash,
          source_created_at,
          source_updated_at,
          source_deleted_at,
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
          source_type,
          provider_document_id
        )
        DO UPDATE SET

          id =
            excluded.id,

          knowledge_source_id =
            excluded.knowledge_source_id,

          title =
            excluded.title,

          content =
            excluded.content,

          source_url =
            excluded.source_url,

          mime_type =
            excluded.mime_type,

          metadata =
            excluded.metadata,

          raw_payload =
            excluded.raw_payload,

          content_hash =
            excluded.content_hash,

          source_created_at =
            excluded.source_created_at,

          source_updated_at =
            excluded.source_updated_at,

          source_deleted_at =
            excluded.source_deleted_at,

          synced_at =
            excluded.synced_at,

          status =
            excluded.status,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(
        document.id,
        document.tenantId,
        document.provider,
        document.knowledgeSourceId,
        document.providerDocumentId,
        document.sourceType,
        document.title,
        document.content,
        document.sourceUrl,
        document.mimeType,
        document.metadata,
        document.rawPayload,
        document.contentHash,
        document.sourceCreatedAt,
        document.sourceUpdatedAt,
        document.sourceDeletedAt,
        document.syncedAt,
        document.status,
      )
      .run();
  }


  async markDeleted(
    tenantId:
      string,

    provider:
      string,

    sourceType:
      string,

    providerDocumentId:
      string,

    syncedAt:
      string,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE knowledge_documents
        SET
          status = 'deleted',
          source_deleted_at = ?,
          synced_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND provider = ?
          AND source_type = ?
          AND provider_document_id = ?
        `,
      )
      .bind(
        syncedAt,
        syncedAt,
        tenantId,
        provider,
        sourceType,
        providerDocumentId,
      )
      .run();
  }


  async markMissingForSourceType(
    tenantId:
      string,

    provider:
      string,

    knowledgeSourceId:
      string,

    sourceType:
      string,

    activeProviderDocumentIds:
      string[],

    syncedAt:
      string,
  ): Promise<number> {

    /*
     * --------------------------------------------------
     * If the provider returned zero active documents,
     * every currently-active document of this source type
     * is considered deleted.
     * --------------------------------------------------
     */

    if (
      activeProviderDocumentIds.length ===
      0
    ) {

      const result =
        await this.db
          .prepare(
            `
            UPDATE knowledge_documents
            SET
              status = 'deleted',
              source_deleted_at = ?,
              synced_at = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ?
              AND provider = ?
              AND knowledge_source_id = ?
              AND source_type = ?
              AND status = 'active'
            `,
          )
          .bind(
            syncedAt,
            syncedAt,
            tenantId,
            provider,
            knowledgeSourceId,
            sourceType,
          )
          .run();


      return (
        result.meta?.changes ??
        0
      );
    }


    /*
     * --------------------------------------------------
     * Otherwise mark active documents that are no longer
     * present in the provider response as deleted.
     * --------------------------------------------------
     */

    const placeholders =
      activeProviderDocumentIds
        .map(
          () =>
            "?",
        )
        .join(
          ", ",
        );


    const result =
      await this.db
        .prepare(
          `
          UPDATE knowledge_documents
          SET
            status = 'deleted',
            source_deleted_at = ?,
            synced_at = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
            AND provider = ?
            AND knowledge_source_id = ?
            AND source_type = ?
            AND status = 'active'
            AND provider_document_id NOT IN (
              ${placeholders}
            )
          `,
        )
        .bind(
          syncedAt,
          syncedAt,
          tenantId,
          provider,
          knowledgeSourceId,
          sourceType,
          ...activeProviderDocumentIds,
        )
        .run();


    return (
      result.meta?.changes ??
      0
    );
  }


  private mapRow(
    row:
      Record<
        string,
        unknown
      >,
  ):
    KnowledgeDocumentRecord {

    return {

      id:
        row.id as string,

      tenantId:
        row.tenant_id as string,

      provider:
        row.provider as string,

      knowledgeSourceId:
        row.knowledge_source_id as string,

      providerDocumentId:
        row.provider_document_id as string,

      sourceType:
        row.source_type as string,

      title:
        row.title as
          string | null,

      content:
        row.content as
          string | null,

      sourceUrl:
        row.source_url as
          string | null,

      mimeType:
        row.mime_type as
          string | null,

      metadata:
        row.metadata as
          string | null,

      rawPayload:
        row.raw_payload as
          string | null,

      contentHash:
        row.content_hash as
          string | null,

      sourceCreatedAt:
        row.source_created_at as
          string | null,

      sourceUpdatedAt:
        row.source_updated_at as
          string | null,

      sourceDeletedAt:
        row.source_deleted_at as
          string | null,

      syncedAt:
        row.synced_at as
          string | null,

      status:
        row.status as
          "active" |
          "deleted",

      createdAt:
        row.created_at as
          string,

      updatedAt:
        row.updated_at as
          string,
    };
  }
}
import type {
  KnowledgeContext,
  KnowledgeSyncMode,
  KnowledgeSyncRequest,
} from "../../core/knowledge";

import {
  resolveKnowledgeProvider,
} from "../../core/knowledge";

import {
  KnowledgeSourceRepository,
} from "../../persistence/repositories/knowledge-source-repository";

import {
  KnowledgeDocumentRepository,
} from "../../persistence/repositories/knowledge-document-repository";


/*
 * --------------------------------------------------
 * Create deterministic content hash
 * --------------------------------------------------
 */

async function createContentHash(
  content:
    string | null,
): Promise<
  string | null
> {

  if (
    !content
  ) {

    return null;
  }


  const data =
    new TextEncoder().encode(
      content,
    );


  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      data,
    );


  return Array
    .from(
      new Uint8Array(
        digest,
      ),
    )
    .map(
      (
        byte,
      ) =>
        byte
          .toString(16)
          .padStart(
            2,
            "0",
          ),
    )
    .join("");
}


/*
 * --------------------------------------------------
 * Knowledge synchronization result
 * --------------------------------------------------
 */

export interface KnowledgeSyncResult {

  mode:
    KnowledgeSyncMode;

  knowledgeSourceId:
    string;

  knowledgeBaseId:
    string;

  documentsFetched:
    number;

  documentsStored:
    number;

  documentsMarkedDeleted:
    number;

  syncedAt:
    string;
}


/*
 * --------------------------------------------------
 * Resolve all source types represented by the
 * current provider synchronization state.
 * --------------------------------------------------
 *
 * IMPORTANT:
 *
 * We do not maintain a permanent source-type whitelist.
 *
 * Provider documents are the primary source of the
 * actual types currently returned.
 *
 * Existing Core documents are also included so that
 * previously-known source types can still be reconciled.
 *
 * Knowledge Base metadata is included when available.
 *
 * This allows newly-supported provider types such as:
 *
 * - faq
 * - rich_text
 * - website
 * - file
 * - table_file
 * - trained_url
 *
 * without changing this sync service every time.
 *
 * NOTE:
 *
 * A provider must actually return a source type for
 * full synchronization to treat an empty response for
 * that source type as authoritative deletion. This
 * avoids accidentally deleting source types that a
 * provider currently does not expose yet.
 * --------------------------------------------------
 */

function resolveReconciliationSourceTypes(
  providerDocuments:
    Array<{
      sourceType:
        string;
      providerDocumentId:
        string;
    }>,

  existingDocuments:
    Array<{
      sourceType:
        string;
      providerDocumentId:
        string;
    }>,

  knowledgeBaseSourceTypes:
    unknown,
):
  string[] {

  const sourceTypes =
    new Set<string>();


  /*
   * ------------------------------------------------
   * 1. Source types actually returned by provider
   * ------------------------------------------------
   */

  for (
    const document of
      providerDocuments
  ) {

    const sourceType =
      document.sourceType?.trim();


    if (
      sourceType
    ) {

      sourceTypes.add(
        sourceType,
      );
    }
  }


  /*
   * ------------------------------------------------
   * 2. Source types already known in Core
   * ------------------------------------------------
   *
   * This matters for incremental evolution and
   * existing data.
   */

  for (
    const document of
      existingDocuments
  ) {

    const sourceType =
      document.sourceType?.trim();


    if (
      sourceType
    ) {

      sourceTypes.add(
        sourceType,
      );
    }
  }


  /*
   * ------------------------------------------------
   * 3. Knowledge Base metadata
   * ------------------------------------------------
   *
   * Some providers expose the asset families on the
   * Knowledge Base itself.
   *
   * We only use string values here.
   */

  if (
    Array.isArray(
      knowledgeBaseSourceTypes,
    )
  ) {

    for (
      const sourceType of
        knowledgeBaseSourceTypes
    ) {

      if (
        typeof sourceType ===
        "string"
      ) {

        const normalized =
          sourceType.trim();


        if (
          normalized
        ) {

          sourceTypes.add(
            normalized,
          );
        }
      }
    }
  }


  return Array
    .from(
      sourceTypes,
    )
    .sort();
}


/*
 * --------------------------------------------------
 * Full Knowledge Base synchronization
 * --------------------------------------------------
 */

export async function syncKnowledgeBase(
  db:
    D1Database,

  context:
    KnowledgeContext,

  knowledgeBaseId:
    string,
): Promise<
  KnowledgeSyncResult
> {

  /*
   * ------------------------------------------------
   * 1. Resolve the generic Knowledge provider
   * ------------------------------------------------
   */

  const provider =
    resolveKnowledgeProvider(
      context
        .tenant
        .integrations
        .crm
        .provider,
    );


  /*
   * ------------------------------------------------
   * 2. Discover the requested Knowledge Base
   * ------------------------------------------------
   */

  const knowledgeBases =
    await provider.listKnowledgeBases(
      context,
    );


  const knowledgeBase =
    knowledgeBases.find(
      (
        source,
      ) =>
        source.providerKnowledgeBaseId ===
        knowledgeBaseId,
    );


  if (
    !knowledgeBase
  ) {

    throw new Error(
      `Knowledge base not found for provider=${context.tenant.integrations.crm.provider} knowledgeBaseId=${knowledgeBaseId}`,
    );
  }


  /*
   * ------------------------------------------------
   * 3. Fetch currently exposed provider documents
   * ------------------------------------------------
   *
   * This remains the canonical FULL synchronization
   * path.
   */

  const documents =
    await provider.listDocuments(
      context,

      knowledgeBaseId,
    );


  const syncedAt =
    new Date().toISOString();


  /*
   * ------------------------------------------------
   * 4. Persist / refresh the parent Knowledge Source
   * ------------------------------------------------
   */

  const sourceRepository =
    new KnowledgeSourceRepository(
      db,
    );


  await sourceRepository.upsert({

    id:
      knowledgeBase.id,

    tenantId:
      knowledgeBase.tenantId,

    provider:
      knowledgeBase.provider,

    providerSourceId:
      knowledgeBase.providerKnowledgeBaseId,

    name:
      knowledgeBase.name,

    description:
      knowledgeBase.description ??
      null,

    metadata:
      JSON.stringify({

        sourceTypes:
          knowledgeBase.sourceTypes,

        knowledgeBaseId:
          knowledgeBase.providerKnowledgeBaseId,

        knowledgeBaseName:
          knowledgeBase.name,

      }),

    rawPayload:
      JSON.stringify(
        knowledgeBase,
      ),

    sourceCreatedAt:
      knowledgeBase.createdAt ??
      null,

    sourceUpdatedAt:
      knowledgeBase.updatedAt ??
      null,

    syncedAt,

    status:
      "active",

    createdAt:
      syncedAt,

    updatedAt:
      syncedAt,
  });


  /*
   * ------------------------------------------------
   * 5. Persist provider documents
   * ------------------------------------------------
   */

  const documentRepository =
    new KnowledgeDocumentRepository(
      db,
    );


  /*
   * ------------------------------------------------
   * Load existing documents before upserting.
   *
   * This gives reconciliation visibility into source
   * types that already exist in Core.
   * ------------------------------------------------
   */

  const existingDocuments =
    await documentRepository.findBySource(
      knowledgeBase.id,
    );


  for (
    const document of
      documents
  ) {

    const contentHash =
      await createContentHash(
        document.content ??
        null,
      );


    await documentRepository.upsert({

      id:
        document.id,

      tenantId:
        document.tenantId,

      provider:
        document.provider,

      knowledgeSourceId:
        knowledgeBase.id,

      providerDocumentId:
        document.providerDocumentId,

      sourceType:
        document.sourceType,

      title:
        document.title ??
        null,

      content:
        document.content ??
        null,

      sourceUrl:
        document.sourceUrl ??
        null,

      mimeType:
        document.mimeType ??
        null,

      metadata:
        JSON.stringify({

          ...(document.metadata ??
            {}),

          knowledgeBaseId:
            knowledgeBase.providerKnowledgeBaseId,

          knowledgeBaseName:
            knowledgeBase.name,

        }),

      rawPayload:
        JSON.stringify(
          document,
        ),

      contentHash,

      sourceCreatedAt:
        document.createdAt ??
        null,

      sourceUpdatedAt:
        document.updatedAt ??
        null,

      sourceDeletedAt:
        null,

      syncedAt,

      status:
        "active",

      createdAt:
        syncedAt,

      updatedAt:
        syncedAt,
    });
  }


  /*
   * ------------------------------------------------
   * 6. Reconcile every known provider source type
   * ------------------------------------------------
   *
   * There is intentionally no hard-coded list such as:
   *
   *     faq / website / rich_text
   *
   * Any source type returned by the provider is eligible.
   * ------------------------------------------------
   */

  const reconciliationSourceTypes =
    resolveReconciliationSourceTypes(
      documents,

      existingDocuments,

      knowledgeBase.sourceTypes,
    );


  let documentsMarkedDeleted =
    0;


  for (
    const sourceType of
      reconciliationSourceTypes
  ) {

    /*
     * ------------------------------------------------
     * Determine whether the provider actually returned
     * this source type in the current full sync.
     * ------------------------------------------------
     */

    const providerReturnedThisSourceType =
      documents.some(
        (
          document,
        ) =>
          document.sourceType ===
          sourceType,
      );


    /*
     * ------------------------------------------------
     * IMPORTANT SAFETY RULE
     * ------------------------------------------------
     *
     * If a source type is only known from existing Core
     * data but the current provider does not expose it,
     * do NOT mark it deleted.
     *
     * Otherwise adding a new provider source type before
     * the provider implementation can retrieve its
     * content would accidentally delete existing data.
     */

    if (
      !providerReturnedThisSourceType
    ) {

      console.log(
        "Knowledge source type reconciliation skipped",
        {

          tenantId:
            context.tenant.id,

          knowledgeSourceId:
            knowledgeBase.id,

          knowledgeBaseId:
            knowledgeBase.providerKnowledgeBaseId,

          sourceType,

          reason:
            "Source type exists in Core knowledge state but was not returned by the current provider document listing. Preserving existing documents.",
        },
      );

      continue;
    }


    /*
     * ------------------------------------------------
     * Active provider documents for this source type
     * ------------------------------------------------
     */

    const activeProviderDocumentIds =
      documents
        .filter(
          (
            document,
          ) =>
            document.sourceType ===
            sourceType,
        )
        .map(
          (
            document,
          ) =>
            document.providerDocumentId,
        );


    /*
     * ------------------------------------------------
     * Reconcile missing provider documents
     * ------------------------------------------------
     */

    const markedDeleted =
      await documentRepository
        .markMissingForSourceType(
          context.tenant.id,

          knowledgeBase.provider,

          knowledgeBase.id,

          sourceType,

          activeProviderDocumentIds,

          syncedAt,
        );


    documentsMarkedDeleted +=
      markedDeleted;


    console.log(
      "Knowledge source type reconciled",
      {

        tenantId:
          context.tenant.id,

        knowledgeSourceId:
          knowledgeBase.id,

        knowledgeBaseId:
          knowledgeBase.providerKnowledgeBaseId,

        sourceType,

        providerDocumentCount:
          activeProviderDocumentIds.length,

        documentsMarkedDeleted:
          markedDeleted,

      },
    );
  }


  /*
   * ------------------------------------------------
   * 7. Return full synchronization result
   * ------------------------------------------------
   */

  return {

    mode:
      "full",

    knowledgeSourceId:
      knowledgeBase.id,

    knowledgeBaseId:
      knowledgeBase.providerKnowledgeBaseId,

    documentsFetched:
      documents.length,

    documentsStored:
      documents.length,

    documentsMarkedDeleted,

    syncedAt,
  };
}


/*
 * --------------------------------------------------
 * Incremental / change synchronization
 * --------------------------------------------------
 *
 * Provider behavior:
 *
 * 1. If the provider supports getDocument():
 *      perform targeted synchronization.
 *
 * 2. If the provider does not support getDocument():
 *      safely fall back to the existing full sync.
 *
 * This gives us a generic capability-aware interface
 * without forcing every provider to implement targeted
 * retrieval.
 * --------------------------------------------------
 */

export async function syncKnowledgeChange(
  db:
    D1Database,

  context:
    KnowledgeContext,

  request:
    KnowledgeSyncRequest,
): Promise<
  KnowledgeSyncResult
> {

  const provider =
    resolveKnowledgeProvider(
      context
        .tenant
        .integrations
        .crm
        .provider,
    );


  /*
   * ------------------------------------------------
   * Explicit full synchronization
   * ------------------------------------------------
   */

  if (
    request.mode ===
    "full"
  ) {

    return syncKnowledgeBase(
      db,

      context,

      request.knowledgeBaseId,
    );
  }


  /*
   * ------------------------------------------------
   * Incremental synchronization
   * ------------------------------------------------
   */

  if (
    request.mode !==
    "incremental"
  ) {

    throw new Error(
      `Unsupported Knowledge sync mode: ${request.mode}`,
    );
  }


  /*
   * ------------------------------------------------
   * Provider capability check
   * ------------------------------------------------
   *
   * getDocument() is optional.
   *
   * When it does not exist, use the proven full-sync
   * reconciliation path.
   */

  if (
    !provider.getDocument
  ) {

    const fullSync =
      await syncKnowledgeBase(
        db,

        context,

        request.knowledgeBaseId,
      );


    return {

      ...fullSync,

      mode:
        "full",
    };
  }


  /*
   * ------------------------------------------------
   * Validate targeted request
   * ------------------------------------------------
   */

  if (
    !request.sourceType
  ) {

    throw new Error(
      "Incremental Knowledge sync requires sourceType.",
    );
  }


  if (
    !request.providerDocumentId
  ) {

    throw new Error(
      "Incremental Knowledge sync requires providerDocumentId.",
    );
  }


  const syncedAt =
    new Date().toISOString();


  /*
   * ------------------------------------------------
   * Resolve Knowledge Base
   * ------------------------------------------------
   */

  const knowledgeBases =
    await provider.listKnowledgeBases(
      context,
    );


  const knowledgeBase =
    knowledgeBases.find(
      (
        source,
      ) =>
        source.providerKnowledgeBaseId ===
        request.knowledgeBaseId,
    );


  if (
    !knowledgeBase
  ) {

    throw new Error(
      `Knowledge base not found for incremental sync: ${request.knowledgeBaseId}`,
    );
  }


  /*
   * ------------------------------------------------
   * Persist / refresh Knowledge Base source
   * ------------------------------------------------
   */

  const sourceRepository =
    new KnowledgeSourceRepository(
      db,
    );


  await sourceRepository.upsert({

    id:
      knowledgeBase.id,

    tenantId:
      knowledgeBase.tenantId,

    provider:
      knowledgeBase.provider,

    providerSourceId:
      knowledgeBase.providerKnowledgeBaseId,

    name:
      knowledgeBase.name,

    description:
      knowledgeBase.description ??
      null,

    metadata:
      JSON.stringify({

        sourceTypes:
          knowledgeBase.sourceTypes,

        knowledgeBaseId:
          knowledgeBase.providerKnowledgeBaseId,

        knowledgeBaseName:
          knowledgeBase.name,

      }),

    rawPayload:
      JSON.stringify(
        knowledgeBase,
      ),

    sourceCreatedAt:
      knowledgeBase.createdAt ??
      null,

    sourceUpdatedAt:
      knowledgeBase.updatedAt ??
      null,

    syncedAt,

    status:
      "active",

    createdAt:
      syncedAt,

    updatedAt:
      syncedAt,
  });


  /*
   * ------------------------------------------------
   * Fetch targeted provider document
   * ------------------------------------------------
   */

  const document =
    await provider.getDocument(
      context,

      request,
    );


  const documentRepository =
    new KnowledgeDocumentRepository(
      db,
    );


  /*
 * --------------------------------------------------
 * Deleted document
 * --------------------------------------------------
 *
 * Only an explicit provider deletion signal is allowed
 * to mark the document deleted.
 *
 * A null result from getDocument() is NOT treated as
 * deletion because provider APIs can be eventually
 * consistent immediately after an update webhook.
 * --------------------------------------------------
 */

if (
  request.deleted
) {

  await documentRepository.markDeleted(
    context.tenant.id,
    knowledgeBase.provider,
    request.sourceType,
    request.providerDocumentId,
    syncedAt,
  );


  console.log(
    "Knowledge document explicitly deleted",
    {
      tenantId:
        context.tenant.id,

      knowledgeBaseId:
        knowledgeBase.providerKnowledgeBaseId,

      sourceType:
        request.sourceType,

      providerDocumentId:
        request.providerDocumentId,
    },
  );


  return {

    mode:
      "incremental",

    knowledgeSourceId:
      knowledgeBase.id,

    knowledgeBaseId:
      knowledgeBase.providerKnowledgeBaseId,

    documentsFetched:
      0,

    documentsStored:
      0,

    documentsMarkedDeleted:
      1,

    syncedAt,
  };
}


/*
 * --------------------------------------------------
 * Provider returned no document for a non-deleted
 * webhook.
 * --------------------------------------------------
 *
 * NEVER mark it deleted here.
 *
 * Fall back to a complete Knowledge Base synchronization
 * so the provider gets another opportunity to expose the
 * updated content.
 * --------------------------------------------------
 */

if (
  !document
) {

  console.warn(
    "Knowledge incremental document lookup returned no document. Falling back to full synchronization instead of marking the document deleted.",
    {
      tenantId:
        context.tenant.id,

      knowledgeBaseId:
        knowledgeBase.providerKnowledgeBaseId,

      sourceType:
        request.sourceType,

      providerDocumentId:
        request.providerDocumentId,
    },
  );


  const fullSync =
    await syncKnowledgeBase(
      db,
      context,
      request.knowledgeBaseId,
    );


  return {

    ...fullSync,

    mode:
      "full",
  };
}


  /*
   * ------------------------------------------------
   * Persist targeted document
   * ------------------------------------------------
   */

  const contentHash =
    await createContentHash(
      document.content ??
      null,
    );


  await documentRepository.upsert({

    id:
      document.id,

    tenantId:
      document.tenantId,

    provider:
      document.provider,

    knowledgeSourceId:
      knowledgeBase.id,

    providerDocumentId:
      document.providerDocumentId,

    sourceType:
      document.sourceType,

    title:
      document.title ??
      null,

    content:
      document.content ??
      null,

    sourceUrl:
      document.sourceUrl ??
      null,

    mimeType:
      document.mimeType ??
      null,

    /*
     * ------------------------------------------------
     * Preserve parent GHL Knowledge Base identity.
     * ------------------------------------------------
     */

    metadata:
      JSON.stringify({

        ...(document.metadata ??
          {}),

        knowledgeBaseId:
          knowledgeBase.providerKnowledgeBaseId,

        knowledgeBaseName:
          knowledgeBase.name,

      }),

    rawPayload:
      JSON.stringify(
        document,
      ),

    contentHash,

    sourceCreatedAt:
      document.createdAt ??
      null,

    sourceUpdatedAt:
      document.updatedAt ??
      null,

    sourceDeletedAt:
      null,

    syncedAt,

    status:
      "active",

    createdAt:
      syncedAt,

    updatedAt:
      syncedAt,
  });


  /*
   * ------------------------------------------------
   * Return incremental result
   * ------------------------------------------------
   */

  return {

    mode:
      "incremental",

    knowledgeSourceId:
      knowledgeBase.id,

    knowledgeBaseId:
      knowledgeBase.providerKnowledgeBaseId,

    documentsFetched:
      1,

    documentsStored:
      1,

    documentsMarkedDeleted:
      0,

    syncedAt,
  };
}
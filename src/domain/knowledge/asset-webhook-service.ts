import {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";


import {
  resolveTenantByProviderLocation,
} from "../../tenants/service";


import type {
  KnowledgeContext,
} from "../../core/knowledge";


import {
  createIntegrationContext,
} from "../../context/integration";


import {
  syncKnowledgeChange,
} from "./sync-service";


import type {
  IntegrationRuntime,
} from "../../core/integration/runtime";


import {
  KnowledgeSourceRepository,
} from "../../persistence/repositories/knowledge-source-repository";


import {
  KnowledgeDocumentRepository,
} from "../../persistence/repositories/knowledge-document-repository";


import {
  reconcileKnowledgeDocumentIndex,
} from "./indexing-service";


/*
 * --------------------------------------------------
 * Generic GHL Knowledge Asset Webhook
 * --------------------------------------------------
 *
 * This handles Knowledge assets for which we have
 * webhook visibility and a content-retrieval path.
 *
 * Current intended asset event types:
 *
 * - KnowledgeBaseFileChange
 * - KnowledgeBaseRichTextChange
 * - KnowledgeBaseTableFileChange
 *
 * The event is persisted into Core's generic
 * integration_events table.
 *
 * Rich Text is incrementally synchronized.
 *
 * Parent Knowledge Base deletion is handled
 * separately by:
 *
 * - KnowledgeBaseDelete
 *
 * Parent deletion:
 *
 *     KnowledgeBaseDelete
 *            ↓
 *     find local Knowledge Source
 *            ↓
 *     load child documents
 *            ↓
 *     reconcile Vectorize deletion
 *            ↓
 *     mark child documents deleted
 *            ↓
 *     mark Knowledge Source deleted
 */


/*
 * --------------------------------------------------
 * GHL Knowledge Asset Webhook Payload
 * --------------------------------------------------
 */

export interface GHLKnowledgeAssetWebhookPayload {

  type:
    string;

  locationId?:
    string;

  knowledgeBaseId?:
    string;

  id?:
    string;

  assetType?:
    string;

  status?:
    string;

  action?:
    string;

  deleted?:
    boolean;

  appId?:
    string;

  versionId?:
    string;

  webhookId?:
    string;

  timestamp?:
    string;
}


/*
 * --------------------------------------------------
 * GHL Knowledge Base Delete Webhook Payload
 * --------------------------------------------------
 *
 * IMPORTANT:
 *
 * For KnowledgeBaseDelete, GHL uses:
 *
 *     id
 *
 * as the Knowledge Base ID.
 *
 * It does NOT use knowledgeBaseId.
 */

export interface GHLKnowledgeBaseDeleteWebhookPayload {

  type?:
    string;

  locationId?:
    string;

  id?:
    string;

  name?:
    string;

  description?:
    string;

  deleted?:
    boolean;

  appId?:
    string;

  versionId?:
    string;

  webhookId?:
    string;

  timestamp?:
    string;
}


/*
 * --------------------------------------------------
 * Required value helper
 * --------------------------------------------------
 */

function requireValue(
  value:
    string |
    undefined,

  fieldName:
    string,

  eventType:
    string,
): string {

  const normalized =
    value?.trim() ??
    "";


  if (
    !normalized
  ) {

    throw new Error(
      `GHL ${eventType} webhook is missing ${fieldName}.`,
    );

  }


  return normalized;
}


/*
 * --------------------------------------------------
 * Process GHL Knowledge Asset Webhook
 * --------------------------------------------------
 */

export async function processGHLKnowledgeAssetWebhook(

  db:
    D1Database,

  payload:
    GHLKnowledgeAssetWebhookPayload,

  integrationRuntime:
    IntegrationRuntime,

): Promise<{

  eventId:
    string;

  eventType:
    string;

  tenantId:
    string;

  knowledgeBaseId:
    string;

  documentId:
    string;

  assetType:
    string;

  duplicate:
    boolean;

  observed:
    boolean;

}> {

  /*
   * ------------------------------------------------
   * Resolve and validate event information
   * ------------------------------------------------
   */

  const eventType =
    requireValue(

      payload.type,

      "type",

      payload.type ??
        "KnowledgeAsset",

    );


  const locationId =
    requireValue(

      payload.locationId,

      "locationId",

      eventType,

    );


  const knowledgeBaseId =
    requireValue(

      payload.knowledgeBaseId,

      "knowledgeBaseId",

      eventType,

    );


  const documentId =
    requireValue(

      payload.id,

      "id",

      eventType,

    );


  const webhookId =
    requireValue(

      payload.webhookId,

      "webhookId",

      eventType,

    );


  const assetType =
    payload.assetType?.trim() ??
    "unknown";


  /*
   * ------------------------------------------------
   * Resolve Core tenant
   * ------------------------------------------------
   */

  const tenant =
    await resolveTenantByProviderLocation(

      db,

      "gohighlevel",

      locationId,

    );


  /*
   * ------------------------------------------------
   * Persist generic integration event
   * ------------------------------------------------
   */

  console.log(

    "GHL KNOWLEDGE ASSET RAW PAYLOAD",

    JSON.stringify(
      payload,
      null,
      2,
    ),

  );


  const eventRepository =
    new IntegrationEventRepository(

      db,

    );


  const eventAccepted =
    await eventRepository.createIfAbsent({

      eventId:
        webhookId,

      tenantId:
        tenant.id,

      eventType,

      aggregateType:
        "knowledge_document",

      aggregateId:
        [
          knowledgeBaseId,
          assetType,
          documentId,
        ].join(":"),

      provider:
        "gohighlevel",

      occurredAt:
        payload.timestamp ??
        new Date().toISOString(),

      receivedAt:
        new Date().toISOString(),

      payload:
        JSON.stringify(
          payload,
        ),

    });


  /*
   * ------------------------------------------------
   * Duplicate event
   * ------------------------------------------------
   */

  if (
    !eventAccepted
  ) {

    console.log(

      "GHL Knowledge asset webhook ignored as duplicate",

      {

        webhookId,

        eventType,

        tenantId:
          tenant.id,

        knowledgeBaseId,

        documentId,

        assetType,

      },

    );

  }


  /*
   * --------------------------------------------------
   * Rich Text synchronization
   * --------------------------------------------------
   *
   * Rich Text is synchronized incrementally when:
   *
   * - the asset is created
   * - the asset is updated
   * - the asset reaches an active/trained state
   *
   * Deleted assets are always synchronized as deleted.
   *
   * Temporary processing states are ignored.
   */

  if (
    assetType ===
    "rich_text"
  ) {

    const action =
      payload.action
        ?.trim()
        .toLowerCase() ??
      "";


    const status =
      payload.status
        ?.trim()
        .toLowerCase() ??
      "";


    /*
     * ------------------------------------------------
     * 1. Deleted Rich Text
     * ------------------------------------------------
     */

    const isDeleted =
      payload.deleted ===
        true ||

      action ===
        "deleted";


    if (
      isDeleted
    ) {

      const context:
        KnowledgeContext =
        createIntegrationContext(

          tenant,

          "gohighlevel",

          integrationRuntime,

        );


      /*
       * ------------------------------------------------
       * Normal provider-aware deletion
       * ------------------------------------------------
       */

      try {

        const sync =
          await syncKnowledgeChange(

            db,

            context,

            {

              mode:
                "incremental",

              knowledgeBaseId,

              sourceType:
                "rich_text",

              providerDocumentId:
                documentId,

              deleted:
                true,

            },

          );


        console.log(

          "GHL Rich Text deleted",

          {

            tenantId:
              tenant.id,

            knowledgeBaseId,

            documentId,

            action,

            status,

            sync,

            deletionMode:
              "provider",

          },

        );

      } catch (
        error
      ) {

        /*
         * ------------------------------------------------
         * Provider fallback
         * ------------------------------------------------
         *
         * GHL can deliver a Rich Text deletion at roughly
         * the same time as KnowledgeBaseDelete.
         *
         * Once the parent KB disappears from GHL, the normal
         * incremental provider lookup cannot resolve it.
         *
         * Core still has the authoritative local source and
         * document records, so perform a local deletion.
         */

        const errorMessage =
          error instanceof Error

            ? error.message

            : String(
                error,
              );


        const sourceRepository =
          new KnowledgeSourceRepository(

            db,

          );


        const documentRepository =
          new KnowledgeDocumentRepository(

            db,

          );


        const localSource =
          await sourceRepository
            .findByTenantProviderSource(

              tenant.id,

              "gohighlevel",

              knowledgeBaseId,

            );


        const syncedAt =
          new Date().toISOString();


        if (
          localSource
        ) {

          await documentRepository.markDeleted(

            tenant.id,

            "gohighlevel",

            "rich_text",

            documentId,

            syncedAt,

          );


          console.warn(

            "GHL Rich Text provider deletion fallback applied",

            {

              tenantId:
                tenant.id,

              knowledgeBaseId,

              knowledgeSourceId:
                localSource.id,

              documentId,

              action,

              status,

              deletionMode:
                "local_fallback",

              reason:
                errorMessage,

            },

          );

        } else {

          /*
           * The parent Knowledge Base may already have been
           * deleted and cleaned up locally.
           *
           * Treat this as an idempotent delete.
           */

          console.log(

            "GHL Rich Text deletion ignored: local Knowledge Source already absent",

            {

              tenantId:
                tenant.id,

              knowledgeBaseId,

              documentId,

              deletionMode:
                "already_deleted",

              reason:
                errorMessage,

            },

          );

        }

      }

    }


    /*
     * ------------------------------------------------
     * 2. Created / updated / active / trained
     * ------------------------------------------------
     */

    else {

      const shouldSynchronize =

        action ===
          "created" ||

        action ===
          "updated" ||

        status ===
          "active" ||

        status ===
          "trained";


      if (
        shouldSynchronize
      ) {

        const context:
          KnowledgeContext =
          createIntegrationContext(

            tenant,

            "gohighlevel",

            integrationRuntime,

          );


        const sync =
          await syncKnowledgeChange(

            db,

            context,

            {

              mode:
                "incremental",

              knowledgeBaseId,

              sourceType:
                "rich_text",

              providerDocumentId:
                documentId,

              deleted:
                false,

            },

          );


        console.log(

          "GHL Rich Text synchronized",

          {

            tenantId:
              tenant.id,

            knowledgeBaseId,

            documentId,

            action,

            status,

            sync,

          },

        );

      }


      /*
       * ------------------------------------------------
       * 3. Ignore temporary/unusable states
       * ------------------------------------------------
       */

      else {

        console.log(

          "GHL Rich Text event ignored",

          {

            tenantId:
              tenant.id,

            knowledgeBaseId,

            documentId,

            action,

            status,

            reason:
              "Rich Text asset has not reached a synchronizable state.",

          },

        );

      }

    }

  }


  /*
   * --------------------------------------------------
   * Return observation result
   * --------------------------------------------------
   */

  return {

    eventId:
      webhookId,

    eventType,

    tenantId:
      tenant.id,

    knowledgeBaseId,

    documentId,

    assetType,

    duplicate:
      !eventAccepted,

    observed:
      true,

  };

}


/*
 * --------------------------------------------------
 * Process GHL Knowledge Base Delete Webhook
 * --------------------------------------------------
 *
 * This handles deletion of the parent Knowledge Base.
 *
 * Example GHL payload:
 *
 * {
 *   "type": "KnowledgeBaseDelete",
 *   "locationId": "...",
 *   "id": "...",
 *   "name": "AI Agent Instructions",
 *   "deleted": true,
 *   "webhookId": "..."
 * }
 *
 * The provider Knowledge API will no longer return
 * the deleted Knowledge Base, so this function works
 * entirely from Core's local state.
 */

export async function processGHLKnowledgeBaseDeleteWebhook(

  db:
    D1Database,

  ai:
    Ai,

  vectorize:
    Vectorize,

  payload:
    GHLKnowledgeBaseDeleteWebhookPayload,

  integrationRuntime:
    IntegrationRuntime,

): Promise<{

  eventId:
    string;

  eventType:
    string;

  tenantId:
    string;

  knowledgeBaseId:
    string;

  knowledgeSourceId:
    string |
    null;

  documentsFound:
    number;

  documentsMarkedDeleted:
    number;

  vectorsDeleted:
    number;

}> {

  /*
   * ------------------------------------------------
   * 1. Validate event type
   * ------------------------------------------------
   */

  const eventType =
    requireValue(

      payload.type,

      "type",

      "KnowledgeBaseDelete",

    );


  /*
   * ------------------------------------------------
   * 2. Resolve identifiers
   * ------------------------------------------------
   *
   * KnowledgeBaseDelete uses payload.id as the
   * Knowledge Base ID.
   */

  const knowledgeBaseId =
    requireValue(

      payload.id,

      "id",

      eventType,

    );


  const locationId =
    requireValue(

      payload.locationId,

      "locationId",

      eventType,

    );


  const eventId =
    payload.webhookId?.trim() ??
    "";


  /*
   * ------------------------------------------------
   * Create deterministic fallback event ID when
   * GHL does not provide webhookId.
   * ------------------------------------------------
   */

  const resolvedEventId =
    eventId ||
    `ghl-kb-delete-${knowledgeBaseId}`;


  /*
   * ------------------------------------------------
   * 3. Resolve tenant
   * ------------------------------------------------
   */

  const tenant =
    await resolveTenantByProviderLocation(

      db,

      "gohighlevel",

      locationId,

    );


  /*
   * ------------------------------------------------
   * 4. Create generic Knowledge context
   * ------------------------------------------------
   *
   * The current KnowledgeContext is created through
   * the same integration context used by the other
   * Knowledge webhook handlers.
   */

  const context:
    KnowledgeContext =
    createIntegrationContext(

      tenant,

      "gohighlevel",

      integrationRuntime,

    );


  /*
   * ------------------------------------------------
   * Context is intentionally created here so this
   * handler remains aligned with the generic
   * Knowledge integration architecture.
   * ------------------------------------------------
   */

  void context;


  /*
   * ------------------------------------------------
   * 5. Persist Knowledge Base deletion event
   * ------------------------------------------------
   *
   * This is a Knowledge Source event, not a
   * Knowledge Document event.
   */

  const eventRepository =
    new IntegrationEventRepository(

      db,

    );


  const eventAccepted =
    await eventRepository.createIfAbsent({

      eventId:
        resolvedEventId,

      tenantId:
        tenant.id,

      eventType:
        "KnowledgeBaseDelete",

      aggregateType:
        "knowledge_source",

      aggregateId:
        knowledgeBaseId,

      provider:
        "gohighlevel",

      occurredAt:
        payload.timestamp ??
        new Date().toISOString(),

      receivedAt:
        new Date().toISOString(),

      payload:
        JSON.stringify(
          payload,
        ),

    });


  /*
   * ------------------------------------------------
   * 6. Duplicate Knowledge Base Delete
   * ------------------------------------------------
   */

  if (
    !eventAccepted
  ) {

    console.log(

      "GHL Knowledge Base delete webhook ignored as duplicate",

      {

        eventId:
          resolvedEventId,

        tenantId:
          tenant.id,

        knowledgeBaseId,

      },

    );


    return {

      eventId:
        resolvedEventId,

      eventType:
        "KnowledgeBaseDelete",

      tenantId:
        tenant.id,

      knowledgeBaseId,

      knowledgeSourceId:
        null,

      documentsFound:
        0,

      documentsMarkedDeleted:
        0,

      vectorsDeleted:
        0,

    };

  }


  /*
   * ------------------------------------------------
   * 7. Find local Knowledge Source
   * ------------------------------------------------
   */

  const sourceRepository =
    new KnowledgeSourceRepository(

      db,

    );


  const knowledgeSource =
    await sourceRepository
      .findByTenantProviderSource(

        tenant.id,

        "gohighlevel",

        knowledgeBaseId,

      );


  /*
   * ------------------------------------------------
   * 8. Already absent locally
   * ------------------------------------------------
   */

  if (
    !knowledgeSource
  ) {

    console.log(

      "GHL Knowledge Base delete ignored: local source not found",

      {

        eventId:
          resolvedEventId,

        tenantId:
          tenant.id,

        knowledgeBaseId,

      },

    );


    return {

      eventId:
        resolvedEventId,

      eventType:
        "KnowledgeBaseDelete",

      tenantId:
        tenant.id,

      knowledgeBaseId,

      knowledgeSourceId:
        null,

      documentsFound:
        0,

      documentsMarkedDeleted:
        0,

      vectorsDeleted:
        0,

    };

  }


  /*
   * ------------------------------------------------
   * 9. Load child Knowledge Documents
   * ------------------------------------------------
   */

  const documentRepository =
    new KnowledgeDocumentRepository(

      db,

    );


  const documents =
    await documentRepository.findBySource(

      knowledgeSource.id,

    );


  const activeDocuments =
    documents.filter(

      (
        document,
      ) =>
        document.status ===
        "active",

    );


  /*
   * ------------------------------------------------
   * 10. Reconcile Vectorize BEFORE marking the
   * parent source deleted.
   * ------------------------------------------------
   *
   * AI Agent Instructions classification depends
   * on the source remaining active while the
   * document is reconciled.
   */

  let vectorsDeleted =
    0;


  for (
    const document of
      activeDocuments
  ) {

    const reconciliation =
      await reconcileKnowledgeDocumentIndex(

        db,

        ai,

        vectorize,

        tenant.id,

        document,

        null,

      );


    vectorsDeleted +=
      reconciliation.vectorsDeleted;


    console.log(

      "GHL Knowledge Base document vector cleanup",

      {

        eventId:
          resolvedEventId,

        knowledgeBaseId,

        knowledgeSourceId:
          knowledgeSource.id,

        documentId:
          document.id,

        sourceType:
          document.sourceType,

        action:
          reconciliation.action,

        vectorsDeleted:
          reconciliation.vectorsDeleted,

        vectorizeMutations:
          reconciliation.vectorizeMutations,

      },

    );

  }


  /*
   * ------------------------------------------------
   * 11. Mark all child documents deleted
   * ------------------------------------------------
   */

  const syncedAt =
    new Date().toISOString();


  let documentsMarkedDeleted =
    0;


  for (
    const document of
      activeDocuments
  ) {

    await documentRepository.markDeleted(

      tenant.id,

      "gohighlevel",

      document.sourceType,

      document.providerDocumentId,

      syncedAt,

    );


    documentsMarkedDeleted +=
      1;

  }


  /*
   * ------------------------------------------------
   * 12. Mark parent Knowledge Source deleted
   * ------------------------------------------------
   */

  await sourceRepository.markDeleted(

    tenant.id,

    "gohighlevel",

    knowledgeBaseId,

    syncedAt,

  );


  /*
   * ------------------------------------------------
   * 13. Final log
   * ------------------------------------------------
   */

  console.log(

    "GHL Knowledge Base deleted and synchronized",

    {

      eventId:
        resolvedEventId,

      tenantId:
        tenant.id,

      knowledgeBaseId,

      knowledgeSourceId:
        knowledgeSource.id,

      knowledgeBaseName:
        knowledgeSource.name,

      documentsFound:
        documents.length,

      activeDocuments:
        activeDocuments.length,

      documentsMarkedDeleted,

      vectorsDeleted,

    },

  );


  /*
   * ------------------------------------------------
   * 14. Return result
   * ------------------------------------------------
   */

  return {

    eventId:
      resolvedEventId,

    eventType:
      "KnowledgeBaseDelete",

    tenantId:
      tenant.id,

    knowledgeBaseId,

    knowledgeSourceId:
      knowledgeSource.id,

    documentsFound:
      documents.length,

    documentsMarkedDeleted,

    vectorsDeleted,

  };

}
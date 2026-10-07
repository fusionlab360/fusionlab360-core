import type {
  KnowledgeContext,
} from "../../core/knowledge";

import {
  createIntegrationContext,
} from "../../context/integration";

import {
  resolveTenantByProviderLocation,
} from "../../tenants/service";

import {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";

import {
  syncKnowledgeChange,
} from "./sync-service";

import {
  KnowledgeDocumentRepository,
} from "../../persistence/repositories/knowledge-document-repository";

import {
  reconcileKnowledgeDocumentIndex,
} from "./indexing-service";

import type {
  IntegrationRuntime,
} from "../../core/integration/runtime";

/*
 * --------------------------------------------------
 * GHL Knowledge FAQ webhook
 * --------------------------------------------------
 */

export interface GHLKnowledgeFaqWebhookPayload {

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
 * GHL Knowledge Trained URL webhook
 * --------------------------------------------------
 */

export interface GHLKnowledgeTrainedUrlWebhookPayload {

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
 * Build generic Core event identity
 * --------------------------------------------------
 */

function requireWebhookId(
  webhookId:
    string |
    undefined,
  eventType:
    string,
): string {

  const value =
    webhookId?.trim() ??
    "";


  if (
    !value
  ) {

    throw new Error(
      `GHL ${eventType} webhook is missing webhookId.`,
    );
  }


  return value;
}


function buildAggregateId(
  knowledgeBaseId:
    string,

  sourceType:
    string,

  providerDocumentId:
    string,
): string {

  return [
    knowledgeBaseId,
    sourceType,
    providerDocumentId,
  ].join(":");
}


/*
 * --------------------------------------------------
 * Persist GHL webhook event once
 * --------------------------------------------------
 */

async function registerKnowledgeWebhookEvent(
  db:
    D1Database,

  tenantId:
    string,

  eventType:
    string,

  knowledgeBaseId:
    string,

  sourceType:
    string,

  providerDocumentId:
    string,

  webhookId:
    string,

  occurredAt:
    string,

  payload:
    unknown,
): Promise<boolean> {

  const eventRepository =
    new IntegrationEventRepository(
      db,
    );


  return eventRepository.createIfAbsent({

    eventId:
      webhookId,

    tenantId,

    eventType,

    aggregateType:
      "knowledge_document",

    aggregateId:
      buildAggregateId(
        knowledgeBaseId,
        sourceType,
        providerDocumentId,
      ),

    provider:
      "gohighlevel",

    occurredAt,

    receivedAt:
      new Date().toISOString(),

    payload:
      JSON.stringify(
        payload,
      ),
  });
}


/*
 * --------------------------------------------------
 * Process FAQ change
 * --------------------------------------------------
 */

export async function processGHLKnowledgeFaqWebhook(

  
  db:
    D1Database,

  ai:
    Ai,

  vectorize:
    Vectorize,

  payload:
    GHLKnowledgeFaqWebhookPayload,

  integrationRuntime:
    IntegrationRuntime,
): Promise<{

  
  knowledgeBaseId:
    string;

  action:
    string | null;

  documentId:
    string | null;

  duplicate:
    boolean;

  sync:
    Awaited<
      ReturnType<
        typeof syncKnowledgeChange
      >
    > |
    null;
}> {

  console.log(
  "GHL FAQ WEBHOOK HANDLER ENTERED",
  {
    type:
      payload?.type,

    locationId:
      payload?.locationId,

    knowledgeBaseId:
      payload?.knowledgeBaseId,

    documentId:
      payload?.id,

    action:
      payload?.action,

    deleted:
      payload?.deleted,

    webhookId:
      payload?.webhookId,
  },
);

  if (
    payload.type !==
    "KnowledgeBaseFaqChange"
  ) {

    throw new Error(
      `Unsupported GHL Knowledge webhook type: ${payload.type}`,
    );
  }


  const locationId =
    payload.locationId?.trim() ??
    "";


  const knowledgeBaseId =
    payload.knowledgeBaseId?.trim() ??
    "";


  const providerDocumentId =
    payload.id?.trim() ??
    "";


  const webhookId =
    requireWebhookId(
      payload.webhookId,
      "KnowledgeBaseFaqChange",
    );


  if (
    !locationId
  ) {

    throw new Error(
      "GHL Knowledge webhook is missing locationId.",
    );
  }


  if (
    !knowledgeBaseId
  ) {

    throw new Error(
      "GHL Knowledge webhook is missing knowledgeBaseId.",
    );
  }


  if (
    !providerDocumentId
  ) {

    throw new Error(
      "GHL Knowledge FAQ webhook is missing document id.",
    );
  }


  const tenant =
    await resolveTenantByProviderLocation(
      db,

      "gohighlevel",

      locationId,
    );


  const eventAccepted =
    await registerKnowledgeWebhookEvent(

      db,

      tenant.id,

      "KnowledgeBaseFaqChange",

      knowledgeBaseId,

      "faq",

      providerDocumentId,

      webhookId,

      payload.timestamp ??
        new Date().toISOString(),

      payload,
    );


  if (
    !eventAccepted
  ) {

    console.log(
      "GHL Knowledge FAQ webhook ignored as duplicate",
      {
        webhookId,

        knowledgeBaseId,

        documentId:
          providerDocumentId,

        action:
          payload.action ??
          null,
      },
    );


    return {

      knowledgeBaseId,

      action:
        payload.action ??
        null,

      documentId:
        providerDocumentId,

      duplicate:
        true,

      sync:
        null,
    };
  }


  const context:
  KnowledgeContext =
  createIntegrationContext(
    tenant,

    "gohighlevel",

    integrationRuntime,
  );


const documentRepository =
  new KnowledgeDocumentRepository(
    db,
  );


const previousDocument =
  await documentRepository.findByTenantProviderDocument(
    tenant.id,

    "gohighlevel",

    "faq",

    providerDocumentId,
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
          "faq",

        providerDocumentId,

        deleted:
          payload.deleted ??
          false,
      },
    );

    const currentDocument =
  await documentRepository.findByTenantProviderDocument(
    tenant.id,
    "gohighlevel",
    "faq",
    providerDocumentId,
  );

const index =
  await reconcileKnowledgeDocumentIndex(
    db,
    ai,
    vectorize,
    tenant.id,
    previousDocument,
    currentDocument,
  );

console.log(
  "GHL Knowledge FAQ index reconciled",
  {
    tenantId:
      tenant.id,

    providerDocumentId,

    action:
      index.action,

    chunksIndexed:
      index.chunksIndexed,

    vectorsDeleted:
      index.vectorsDeleted,

    vectorizeMutations:
      index.vectorizeMutations,
  },
);


  return {

    knowledgeBaseId,

    action:
      payload.action ??
      null,

    documentId:
      providerDocumentId,

    duplicate:
      false,

    sync,
  };
}


/*
 * --------------------------------------------------
 * Process Trained URL change
 * --------------------------------------------------
 */

export async function processGHLKnowledgeTrainedUrlWebhook(
  db:
    D1Database,

  payload:
    GHLKnowledgeTrainedUrlWebhookPayload,

  integrationRuntime:
    IntegrationRuntime,
): Promise<{
  knowledgeBaseId:
    string;

  action:
    string | null;

  documentId:
    string | null;

  duplicate:
    boolean;

  sync:
    Awaited<
      ReturnType<
        typeof syncKnowledgeChange
      >
    > |
    null;
}> {

  if (
    payload.type !==
    "KnowledgeBaseTrainedUrlChange"
  ) {

    throw new Error(
      `Unsupported GHL Knowledge webhook type: ${payload.type}`,
    );
  }


  const locationId =
    payload.locationId?.trim() ??
    "";


  const knowledgeBaseId =
    payload.knowledgeBaseId?.trim() ??
    "";


  const providerDocumentId =
    payload.id?.trim() ??
    "";


  const webhookId =
    requireWebhookId(
      payload.webhookId,
      "KnowledgeBaseTrainedUrlChange",
    );


  if (
    !locationId
  ) {

    throw new Error(
      "GHL Trained URL webhook is missing locationId.",
    );
  }


  if (
    !knowledgeBaseId
  ) {

    throw new Error(
      "GHL Trained URL webhook is missing knowledgeBaseId.",
    );
  }


  if (
    !providerDocumentId
  ) {

    throw new Error(
      "GHL Trained URL webhook is missing document id.",
    );
  }


  const tenant =
    await resolveTenantByProviderLocation(
      db,

      "gohighlevel",

      locationId,
    );


  const eventAccepted =
    await registerKnowledgeWebhookEvent(

      db,

      tenant.id,

      "KnowledgeBaseTrainedUrlChange",

      knowledgeBaseId,

      "website",

      providerDocumentId,

      webhookId,

      payload.timestamp ??
        new Date().toISOString(),

      payload,
    );


  if (
    !eventAccepted
  ) {

    console.log(
      "GHL Knowledge trained URL webhook ignored as duplicate",
      {
        webhookId,

        knowledgeBaseId,

        documentId:
          providerDocumentId,

        action:
          payload.action ??
          null,
      },
    );


    return {

      knowledgeBaseId,

      action:
        payload.action ??
        null,

      documentId:
        providerDocumentId,

      duplicate:
        true,

      sync:
        null,
    };
  }


  const context:
  KnowledgeContext =
  createIntegrationContext(
    tenant,

    "gohighlevel",

    integrationRuntime,
  );

const documentRepository =
  new KnowledgeDocumentRepository(
    db,
  );

  const previousDocument =
    await documentRepository.findByTenantProviderDocument(
      tenant.id,
      "gohighlevel",
      "website",
      providerDocumentId,
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
          "website",

        providerDocumentId,

        deleted:
          payload.deleted ??
          false,
      },
    );


  return {

    knowledgeBaseId,

    action:
      payload.action ??
      null,

    documentId:
      providerDocumentId,

    duplicate:
      false,

    sync,
  };
}
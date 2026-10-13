import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  verifyGHLSignature,
} from "../../integrations/messaging/gohighlevel/signature";

import {
  parseGHLInboundMessage,
  type GHLInboundMessagePayload,
} from "../../integrations/messaging/gohighlevel/webhook";

import {
  processGHLInstall,
  processGHLAppUpdate,
  type GHLInstallWebhookPayload,
} from "../../integrations/messaging/gohighlevel/install";

import {
  resolveTenantByProviderLocation,
} from "../../tenants/service";

import {
  createIntegrationContext,
} from "../../context/integration";

import type {
  KnowledgeContext,
} from "../../core/knowledge";

import {
  resolveAIProvider,
} from "../../core/ai";

import {
  resolveMessagingProvider,
} from "../../core/messaging";

import {
  classifyInboundProcessingError,
  InboundEventLeaseActiveError,
  processGHLInboundMessage,
  type KnowledgeRetriever,
} from "./inbound-service";
import {
  createInboundCorrelationId,
  traceInboundOperation,
} from "./inbound-diagnostics";
import { withDurableOutboundDelivery } from "./outbound-delivery";

import {
  processGHLKnowledgeFaqWebhook,
  processGHLKnowledgeTrainedUrlWebhook,
  type GHLKnowledgeFaqWebhookPayload,
  type GHLKnowledgeTrainedUrlWebhookPayload,
} from "../knowledge/webhook-service";

import {
  processGHLKnowledgeAssetWebhook,
  processGHLKnowledgeBaseDeleteWebhook,
  type GHLKnowledgeAssetWebhookPayload,
  type GHLKnowledgeBaseDeleteWebhookPayload,
} from "../knowledge/asset-webhook-service";

import {
  createTenantKnowledgeRetriever,
} from "./tenant-knowledge-retriever";

import {
  createIntegrationRuntime,
} from "../../application/integration/runtime";

import {
  syncKnowledgeBase,
} from "../knowledge/sync-service";
import type {
  GHLInboundQueueEnvelope,
} from "./inbound-queue-contract";
import {
  publishGHLInboundQueueEvent,
} from "./inbound-queue";


function getErrorClassification(
  error: unknown,
): string {
  return error instanceof Error
    ? error.name
    : typeof error;
}

export async function awaitInboundMessageProcessing(
  processing: Promise<void>,
): Promise<
  | { success: true }
  | { success: false; retryAfterSeconds?: number }
> {
  try {
    await processing;
    return { success: true };
  } catch (error: unknown) {
    console.error(
      "GHL inbound message processing failed.",
      {
        operation: "inbound_pipeline",
        classification: classifyInboundProcessingError(error),
      },
    );
    return {
      success: false,
      ...(error instanceof InboundEventLeaseActiveError
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  }
}

export async function respondAfterInboundMessageProcessing<T, F>(
  processing: Promise<void>,
  acknowledge: () => T,
  reject: (retryAfterSeconds?: number) => F,
): Promise<T | F> {
  const result = await awaitInboundMessageProcessing(processing);
  return result.success
    ? acknowledge()
    : reject(result.retryAfterSeconds);
}

export async function respondAfterInboundQueueAcceptance<T, F>(
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  envelope: GHLInboundQueueEnvelope,
  acknowledge: () => T,
  reject: (error: unknown) => F,
  correlationId?: string,
): Promise<T | F> {
  try {
    const publish = () => publishGHLInboundQueueEvent(queue, envelope);
    if (correlationId) {
      await traceInboundOperation("queue_publish", correlationId, publish);
    } else {
      await publish();
    }
    return acknowledge();
  } catch (error: unknown) {
    return reject(error);
  }
}


export async function ghlInboundMessageController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  /*
   * --------------------------------------------------
   * 1. Read raw request body
   * --------------------------------------------------
   */

  const rawBody =
    await c.req.text();

  const signature =
    c.req.header(
      "X-GHL-Signature",
    );

    console.log(
  "FL360 WEBHOOK CONTROLLER VERSION",
  {
    version:
      "2026-10-14-inbound-lifecycle-01",

    path:
      c.req.path,

    method:
      c.req.method,
  },
);

    console.log(
  "GHL WEBHOOK RECEIVED",
  {
    bodyLength:
      rawBody.length,

    signaturePresent:
      Boolean(signature),
  },
);


  /*
   * --------------------------------------------------
   * 2. Read GHL signature
   * --------------------------------------------------
   */

  /*
   * --------------------------------------------------
   * 3. Verify webhook authenticity
   * --------------------------------------------------
   */

  const signatureValid =
    await verifyGHLSignature(
      rawBody,
      signature,
    );


  if (
    !signatureValid
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "Invalid GHL webhook signature.",
      },

      401,
    );
  }


  /*
   * --------------------------------------------------
   * 4. Parse JSON
   * --------------------------------------------------
   */

  let payload:
    unknown;


  try {

    payload =
      JSON.parse(
        rawBody,
      );

  } catch {

    return c.json(
      {
        success:
          false,

        message:
          "Invalid JSON payload.",
      },

      400,
    );
  }


  /*
   * --------------------------------------------------
   * 5. Resolve event type
   * --------------------------------------------------
   */

  const eventType =
    typeof payload ===
      "object" &&

    payload !==
      null &&

    "type" in
      payload &&

    typeof (
      payload as {
        type?:
          unknown;
      }
    ).type ===
      "string"

      ? (
          payload as {
            type:
              string;
          }
        ).type

      : null;


  /*
   * --------------------------------------------------
   * 6. GHL INSTALL
   * --------------------------------------------------
   */

  if (
    eventType ===
    "INSTALL"
  ) {

    c.executionCtx.waitUntil(

      processGHLInstall(

        c.env.DB,

        {
          GHL_OAUTH_CLIENT_ID:
            c.env.GHL_OAUTH_CLIENT_ID,

          GHL_OAUTH_CLIENT_SECRET:
            c.env.GHL_OAUTH_CLIENT_SECRET,

          GHL_OAUTH_REDIRECT_URI:
            c.env.GHL_OAUTH_REDIRECT_URI,
        },

        payload as
          GHLInstallWebhookPayload,

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL INSTALL processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "INSTALL",

    });

  }


  /*
   * --------------------------------------------------
   * 7. GHL APP UPDATE
   * --------------------------------------------------
   */

  if (
    eventType ===
    "UPDATE"
  ) {

    c.executionCtx.waitUntil(

      processGHLAppUpdate(

        c.env.DB,

        {
          GHL_OAUTH_CLIENT_ID:
            c.env.GHL_OAUTH_CLIENT_ID,

          GHL_OAUTH_CLIENT_SECRET:
            c.env.GHL_OAUTH_CLIENT_SECRET,

          GHL_OAUTH_REDIRECT_URI:
            c.env.GHL_OAUTH_REDIRECT_URI,
        },

        payload as
          GHLInstallWebhookPayload,

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL APP UPDATE processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "UPDATE",

    });

  }


  /*
   * --------------------------------------------------
   * 8. Integration runtime
   * --------------------------------------------------
   */

  const integrationRuntime =
    createIntegrationRuntime(

      "gohighlevel",

      {

        DB:
          c.env.DB,

        GHL_OAUTH_CLIENT_ID:
          c.env.GHL_OAUTH_CLIENT_ID,

        GHL_OAUTH_CLIENT_SECRET:
          c.env.GHL_OAUTH_CLIENT_SECRET,

        GHL_OAUTH_REDIRECT_URI:
          c.env.GHL_OAUTH_REDIRECT_URI,

      },

    );


  /*
   * --------------------------------------------------
   * 9. GHL Knowledge Base FAQ
   * --------------------------------------------------
   */

  if (
    eventType ===
    "KnowledgeBaseFaqChange"
  ) {

    c.executionCtx.waitUntil(

      processGHLKnowledgeFaqWebhook(

        c.env.DB,

        c.env.AI,

        c.env.VECTORIZE_V2,

        payload as
          GHLKnowledgeFaqWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge FAQ webhook processed",

            {
              knowledgeBaseId: result.knowledgeBaseId,
              action: result.action,
              documentId: result.documentId,
              duplicate: result.duplicate,
              syncPerformed: result.sync !== null,
            },

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge FAQ webhook processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "KnowledgeBaseFaqChange",

    });

  }


  /*
   * --------------------------------------------------
   * 10. GHL Knowledge Base trained URL
   * --------------------------------------------------
   */

  if (
    eventType ===
    "KnowledgeBaseTrainedUrlChange"
  ) {

    c.executionCtx.waitUntil(

      processGHLKnowledgeTrainedUrlWebhook(

        c.env.DB,

        payload as
          GHLKnowledgeTrainedUrlWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge trained URL webhook processed",

            {
              knowledgeBaseId: result.knowledgeBaseId,
              action: result.action,
              documentId: result.documentId,
              duplicate: result.duplicate,
              syncPerformed: result.sync !== null,
            },

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge trained URL webhook processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "KnowledgeBaseTrainedUrlChange",

    });

  }


  /*
   * --------------------------------------------------
   * 11. GHL Knowledge Base creation
   * --------------------------------------------------
   *
   * GHL KnowledgeBaseCreate uses:
   *
   *     payload.id
   *
   * as the Knowledge Base ID.
   */

  if (
    eventType ===
    "KnowledgeBaseCreate"
  ) {

    console.log(

      "GHL KNOWLEDGE BASE CREATE",

      {

        knowledgeBaseId:

          typeof (

            payload as Record<
              string,
              unknown
            >

          ).id ===
            "string"

            ? (

                payload as Record<
                  string,
                  unknown
                >

              ).id

            : null,

        locationId:

          typeof (

            payload as Record<
              string,
              unknown
            >

          ).locationId ===
            "string"

            ? (

                payload as Record<
                  string,
                  unknown
                >

              ).locationId

            : null,

        namePresent:
          typeof (
            payload as Record<
              string,
              unknown
            >
          ).name === "string",

        deleted:

          (

            payload as Record<
              string,
              unknown
            >

          ).deleted,

        webhookId:

          typeof (

            payload as Record<
              string,
              unknown
            >

          ).webhookId ===
            "string"

            ? (

                payload as Record<
                  string,
                  unknown
                >

              ).webhookId

            : null,

      },

    );


    const createPayload =
      payload &&
      typeof payload ===
        "object"

        ? payload as Record<
            string,
            unknown
          >

        : {};


    const knowledgeBaseId =
      typeof createPayload.id ===
        "string"

        ? createPayload.id.trim()

        : "";


    const locationId =
      typeof createPayload.locationId ===
        "string"

        ? createPayload.locationId.trim()

        : "";


    if (
      !knowledgeBaseId
    ) {

      console.warn(

        "GHL KnowledgeBaseCreate ignored: missing knowledgeBaseId",

      );


      return c.json({

        success:
          true,

        accepted:
          true,

        ignored:
          true,

        eventType:
          "KnowledgeBaseCreate",

      });

    }


    if (
      !locationId
    ) {

      console.warn(

        "GHL KnowledgeBaseCreate ignored: missing locationId",

      );


      return c.json({

        success:
          true,

        accepted:
          true,

        ignored:
          true,

        eventType:
          "KnowledgeBaseCreate",

      });

    }


    c.executionCtx.waitUntil(

      (async () => {

        /*
         * ----------------------------------------------
         * Resolve tenant from GHL location
         * ----------------------------------------------
         */

        const tenant =
          await resolveTenantByProviderLocation(

            c.env.DB,

            "gohighlevel",

            locationId,

          );


        /*
         * ----------------------------------------------
         * Build KnowledgeContext
         *
         * KnowledgeContext does NOT contain:
         *
         *     db
         *     provider
         *
         * DB is passed separately to syncKnowledgeBase().
         * ----------------------------------------------
         */

        const knowledgeContext:
  KnowledgeContext = {

  tenant,

  requestId:
    typeof createPayload.webhookId ===
      "string" &&
    createPayload.webhookId.trim()
      ? createPayload.webhookId.trim()
      : `ghl-kb-create-${crypto.randomUUID()}`,

  receivedAt:
    typeof createPayload.timestamp ===
      "string" &&
    createPayload.timestamp.trim()
      ? new Date(
          createPayload.timestamp.trim(),
        )
      : new Date(),

  integrationRuntime,
};


        /*
         * ----------------------------------------------
         * Bounded retry for GHL API propagation
         * ----------------------------------------------
         */

        const retryDelays = [

          0,

          1000,

          2500,

        ];


        let lastError:
          unknown =
            undefined;


        for (

          let attempt =
            0;

          attempt <
            retryDelays.length;

          attempt +=
            1

        ) {

          const delay =
            retryDelays[
              attempt
            ];


          if (
            delay >
            0
          ) {

            await new Promise<void>(

              (
                resolve,
              ) => {

                setTimeout(

                  resolve,

                  delay,

                );

              },

            );

          }


          try {

            const result =
              await syncKnowledgeBase(

                c.env.DB,

                knowledgeContext,

                knowledgeBaseId,

              );


            console.log(

              "GHL Knowledge Base created and synchronized",

              {

                knowledgeBaseId,

                locationId,

                attempt:
                  attempt +
                  1,

                result,

              },

            );


            return;

          } catch (
            error
          ) {

            lastError =
              error;


            console.warn(

              "GHL KnowledgeBaseCreate synchronization attempt failed",

              {

                knowledgeBaseId,

                locationId,

                attempt:
                  attempt +
                  1,

                attempts:
                  retryDelays.length,

                message:

                  getErrorClassification(error),

              },

            );

          }

        }


        console.error(

          "GHL Knowledge Base creation synchronization failed after retries.",

          {

            knowledgeBaseId,

            locationId,

            error:

              getErrorClassification(lastError),

          },

        );

      })().catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge Base creation background task failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "KnowledgeBaseCreate",

    });

  }


  /*
   * --------------------------------------------------
   * 12. GHL Knowledge Base deletion
   * --------------------------------------------------
   *
   * IMPORTANT:
   *
   * KnowledgeBaseDelete uses payload.id as the
   * Knowledge Base ID.
   *
   * This event must be handled BEFORE the generic
   * inbound-message parser.
   *
   * The dedicated service works from Core's local
   * knowledge_sources state because a deleted GHL
   * Knowledge Base is no longer returned by the GHL
   * Knowledge API.
   */

  if (
    eventType ===
    "KnowledgeBaseDelete"
  ) {

    c.executionCtx.waitUntil(

      processGHLKnowledgeBaseDeleteWebhook(

          c.env.DB,

          c.env.AI,

          c.env.VECTORIZE_V2,

          payload as
            GHLKnowledgeBaseDeleteWebhookPayload,

          integrationRuntime,

        ).then(

        (
          result,
        ) => {

          console.log(
            "GHL Knowledge Base delete webhook processed",
            {
              eventId: result.eventId,
              eventType: result.eventType,
              tenantId: result.tenantId,
              knowledgeBaseId: result.knowledgeBaseId,
              knowledgeSourceId: result.knowledgeSourceId,
              documentsFound: result.documentsFound,
              documentsMarkedDeleted: result.documentsMarkedDeleted,
              vectorsDeleted: result.vectorsDeleted,
            },

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge Base delete webhook processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType:
        "KnowledgeBaseDelete",

    });

  }


  /*
   * --------------------------------------------------
   * 13. GHL Knowledge asset events
   * --------------------------------------------------
   *
   * Rich Text assets are synchronized through the
   * generic Knowledge provider and incremental sync.
   *
   * Files and tables remain observation-only until
   * their provider content retrieval implementation
   * is available.
   */

  if (

    eventType ===
      "KnowledgeBaseFileChange" ||

    eventType ===
      "KnowledgeBaseRichTextChange" ||

    eventType ===
      "KnowledgeBaseTableFileChange"

  ) {

    c.executionCtx.waitUntil(

      processGHLKnowledgeAssetWebhook(

        c.env.DB,

        c.env.AI,

        c.env.VECTORIZE_V2,

        payload as
          GHLKnowledgeAssetWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge asset webhook observed",

            {
              eventId: result.eventId,
              eventType: result.eventType,
              tenantId: result.tenantId,
              knowledgeBaseId: result.knowledgeBaseId,
              documentId: result.documentId,
              assetType: result.assetType,
              duplicate: result.duplicate,
              observed: result.observed,
            },

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge asset webhook processing failed.",

            getErrorClassification(error),

          );

        },

      ),

    );


    return c.json({

      success:
        true,

      accepted:
        true,

      eventType,

    });

  }


  /*
   * --------------------------------------------------
   * 14. Diagnostic logging
   * --------------------------------------------------
   */

  const diagnosticPayload =
    payload as Record<
      string,
      unknown
    >;


  console.log(

    "GHL inbound diagnostic",

    {

      type:
        diagnosticPayload.type,

      direction:
        diagnosticPayload.direction,

      messageType:
        diagnosticPayload.messageType,

      messageTypeString:
        diagnosticPayload.messageTypeString,

      messageTypeId:
        diagnosticPayload.messageTypeId,

      conversationProviderId:
        diagnosticPayload.conversationProviderId,

      locationId:
        diagnosticPayload.locationId,

      conversationId:
        diagnosticPayload.conversationId,

      contactId:
        diagnosticPayload.contactId,

    },

  );


  /*
   * --------------------------------------------------
   * 15. Inbound message payload
   * --------------------------------------------------
   */

  const inboundPayload =
    payload as
      GHLInboundMessagePayload;


  /*
   * --------------------------------------------------
   * 16. Normalize GHL inbound message
   * --------------------------------------------------
   */

  const message =
    parseGHLInboundMessage(

      inboundPayload,

    );


  console.log(

    "GHL message parser result",

    {

      parsed:
        Boolean(
          message,
        ),

      conversationId:
        message?.conversationId,

      contactId:
        message?.contactId,

      locationId:
        message?.locationId,

      channel:
        message?.channel,

    },

  );


  /*
   * --------------------------------------------------
   * 17. Ignore unsupported events
   * --------------------------------------------------
   */

  if (
    !message
  ) {

    console.log(

      "GHL inbound message ignored by parser",

    );


    return c.json({

      success:
        true,

      ignored:
        true,

    });

  }


  /*
   * --------------------------------------------------
   * 18. Resolve tenant
   * --------------------------------------------------
   */

  const correlationId = await createInboundCorrelationId(
    message.providerMessageId,
  );
  const tenant =
    await traceInboundOperation("tenant_resolution", correlationId, () => resolveTenantByProviderLocation(

      c.env.DB,

      "gohighlevel",

      message.locationId,

    ));


  /*
   * --------------------------------------------------
   * 19. Create generic integration context
   * --------------------------------------------------
   */

  const context =
    createIntegrationContext(

      tenant,

      "gohighlevel",

      integrationRuntime,

    );

  if (c.env.GHL_INBOUND_QUEUE_ENABLED === "true") {
    const envelope: GHLInboundQueueEnvelope = {
      version: 1,
      tenantId: context.tenant.id,
      provider: "gohighlevel",
      sourceEventId: message.providerMessageId,
      message,
    };

    return respondAfterInboundQueueAcceptance(
      c.env.GHL_INBOUND_QUEUE,
      envelope,
      () => c.json({
        success: true,
        accepted: true,
        eventId: message.providerMessageId,
      }),
      (error) => {
        console.error(
          "GHL inbound event could not be durably accepted.",
          {
            operation: "queue_publish",
            classification: classifyInboundProcessingError(error),
          },
        );
        return c.json(
          { success: false, message: "Inbound event could not be accepted." },
          503,
        );
      },
      correlationId,
    );
  }


  /*
   * --------------------------------------------------
   * 20. Resolve AI provider
   * --------------------------------------------------
   */

  const ai =
    resolveAIProvider(

      c.env.AI,

      {

        provider:
          "hybrid",

        geminiApiKey:
          c.env.GEMINI_API_KEY,

      },

    );


  /*
   * --------------------------------------------------
   * 21. Resolve messaging provider
   * --------------------------------------------------
   */

  const messaging =
    resolveMessagingProvider(

      context.provider,

    );


  /*
   * --------------------------------------------------
   * 22. Create generic Knowledge retriever
   * --------------------------------------------------
   */

  const knowledgeRetriever: KnowledgeRetriever =
    createTenantKnowledgeRetriever({
      ai: c.env.AI,
      vectorize: c.env.VECTORIZE_V2,
      tenantId: context.tenant.id,
      db: c.env.DB,
      topK: 20,
    });


    
  /*
   * --------------------------------------------------
   * 23. Process inbound message asynchronously
   * --------------------------------------------------
   */

  return respondAfterInboundMessageProcessing(
    processGHLInboundMessage(

      c.env.DB,

      context,

      ai,

      messaging,

      message,

      knowledgeRetriever,

      c.env.AI_BOOKING_ENABLED ===
        "true",

      (provider, eventId, _leaseToken, renewLease) =>
        withDurableOutboundDelivery(
          c.env.DB,
          provider,
          eventId,
          renewLease,
        ),

      "synchronous_webhook",

    ),
    () => c.json({
      success: true,
      accepted: true,
      eventId: message.providerMessageId,
    }),
    (retryAfterSeconds) => c.json(
      { success: false, message: "Inbound message processing failed." },
      503,
      retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
    ),
  );

}

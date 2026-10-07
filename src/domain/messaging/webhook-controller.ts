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
  processGHLInboundMessage,
  type KnowledgeRetriever,
} from "./inbound-service";

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
  searchKnowledgeForTenant,
} from "../knowledge/retrieval-service";

import {
  createIntegrationRuntime,
} from "../../application/integration/runtime";

import {
  syncKnowledgeBase,
} from "../knowledge/sync-service";


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

    console.log(
  "FL360 WEBHOOK CONTROLLER VERSION",
  {
    version:
      "2026-10-07-oauth-knowledge-01",

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
      Boolean(
        c.req.header(
          "X-GHL-Signature",
        ),
      ),

    bodyPreview:
      rawBody.slice(
        0,
        1000,
      ),
  },
);


  /*
   * --------------------------------------------------
   * 2. Read GHL signature
   * --------------------------------------------------
   */

  const signature =
    c.req.header(
      "X-GHL-Signature",
    );


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

            error instanceof Error
              ? error.message
              : error,

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

            error instanceof Error
              ? error.message
              : error,

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

        c.env.VECTORIZE,

        payload as
          GHLKnowledgeFaqWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge FAQ webhook processed",

            result,

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge FAQ webhook processing failed.",

            error instanceof Error
              ? error.message
              : error,

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

            result,

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge trained URL webhook processing failed.",

            error instanceof Error
              ? error.message
              : error,

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

        name:

          typeof (

            payload as Record<
              string,
              unknown
            >

          ).name ===
            "string"

            ? (

                payload as Record<
                  string,
                  unknown
                >

              ).name

            : null,

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

                  error instanceof Error

                    ? error.message

                    : error,

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

              lastError instanceof Error

                ? lastError.message

                : lastError,

          },

        );

      })().catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge Base creation background task failed.",

            error instanceof Error

              ? error.message

              : error,

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

        c.env.VECTORIZE,

        payload as
          GHLKnowledgeBaseDeleteWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge Base delete webhook processed",

            result,

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge Base delete webhook processing failed.",

            error instanceof Error

              ? error.message

              : error,

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

        payload as
          GHLKnowledgeAssetWebhookPayload,

        integrationRuntime,

      ).then(

        (
          result,
        ) => {

          console.log(

            "GHL Knowledge asset webhook observed",

            result,

          );

        },

      ).catch(

        (
          error:
            unknown,
        ) => {

          console.error(

            "GHL Knowledge asset webhook processing failed.",

            error instanceof Error

              ? error.message

              : error,

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

  const tenant =
    await resolveTenantByProviderLocation(

      c.env.DB,

      "gohighlevel",

      message.locationId,

    );


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

  const knowledgeRetriever:
    KnowledgeRetriever = {

      async search(

        query:
          string,

      ) {

        const result =
          await searchKnowledgeForTenant(
            c.env.AI,
            c.env.VECTORIZE,
            context.tenant.id,
            query,
            20,
          );


        return result.matches.map(

          (
            match,
          ) => ({

            title:
              match.title,

            sourceType:
              match.sourceType,

            content:
              match.content,

            score:
              match.score,

          }),

        );

      },

    };


  /*
   * --------------------------------------------------
   * 23. Process inbound message asynchronously
   * --------------------------------------------------
   */

  c.executionCtx.waitUntil(

    processGHLInboundMessage(

      c.env.DB,

      context,

      ai,

      messaging,

      message,

      knowledgeRetriever,

      c.env.AI_BOOKING_ENABLED ===
        "true",

    ).catch(

      (
        error:
          unknown,
      ) => {

        console.error(

          "GHL inbound message processing failed.",

          error instanceof Error

            ? error.message

            : error,

        );

      },

    ),

  );


  /*
   * --------------------------------------------------
   * 24. Acknowledge inbound message
   * --------------------------------------------------
   */

  return c.json({

    success:
      true,

    accepted:
      true,

    eventId:
      message.providerMessageId,

  });

}
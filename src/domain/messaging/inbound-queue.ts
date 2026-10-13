import type { AppBindings } from "../../config/app";
import type { IntegrationContext } from "../../context/integration";
import { createIntegrationContext } from "../../context/integration";
import { resolveAIProvider } from "../../core/ai";
import { resolveMessagingProvider } from "../../core/messaging";
import { createIntegrationRuntime } from "../../application/integration/runtime";
import { resolveTenantByProviderLocation } from "../../tenants/service";
import { createTenantKnowledgeRetriever } from "./tenant-knowledge-retriever";
import {
  classifyInboundProcessingError,
  processGHLInboundMessage,
  InboundEventLeaseActiveError,
} from "./inbound-service";
import type { GHLInboundQueueEnvelope } from "./inbound-queue-contract";
import { withDurableOutboundDelivery } from "./outbound-delivery";
import {
  createInboundCorrelationId,
  traceInboundOperation,
} from "./inbound-diagnostics";

function retryDelaySeconds(attempts: number): number {
  const schedule = [5, 15, 30, 60, 120, 300];
  return schedule[Math.min(Math.max(attempts - 1, 0), schedule.length - 1)];
}

export async function publishGHLInboundQueueEvent(
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  envelope: GHLInboundQueueEnvelope,
): Promise<void> {
  if (!queue) {
    throw new Error("GHL inbound Queue binding is not configured.");
  }
  await queue.send(envelope);
}

export async function handleGHLInboundQueueBatch(
  batch: MessageBatch<GHLInboundQueueEnvelope>,
  processor: (envelope: GHLInboundQueueEnvelope) => Promise<number | null>,
): Promise<void> {
  await Promise.all(batch.messages.map(async (message) => {
    try {
      const retryAfterSeconds = await processor(message.body);
      if (retryAfterSeconds !== null) {
        message.retry({ delaySeconds: retryAfterSeconds });
      } else {
        message.ack();
      }
    } catch (error: unknown) {
      console.error(
        "GHL inbound Queue message processing failed.",
        {
          operation: "queue_consumer",
          classification: classifyInboundProcessingError(error),
        },
      );
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    }
  }));
}

function isQueueEnvelope(value: unknown): value is GHLInboundQueueEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<GHLInboundQueueEnvelope>;
  const message = envelope.message;
  return envelope.version === 1 &&
    typeof envelope.tenantId === "string" &&
    envelope.provider === "gohighlevel" &&
    typeof envelope.sourceEventId === "string" &&
    !!message &&
    message.provider === "gohighlevel" &&
    message.providerMessageId === envelope.sourceEventId &&
    typeof message.locationId === "string" &&
    typeof message.conversationId === "string" &&
    typeof message.contactId === "string" &&
    typeof message.text === "string";
}

async function processEnvelope(
  rawEnvelope: GHLInboundQueueEnvelope,
  env: AppBindings,
): Promise<number | null> {
  if (!isQueueEnvelope(rawEnvelope)) {
    throw new Error("Invalid GHL inbound Queue envelope.");
  }

  const message = rawEnvelope.message;
  const correlationId = await createInboundCorrelationId(
    message.providerMessageId,
  );
  const tenant = await traceInboundOperation("tenant_resolution", correlationId, () => resolveTenantByProviderLocation(
    env.DB,
    "gohighlevel",
    message.locationId,
  ));
  if (tenant.id !== rawEnvelope.tenantId) {
    throw new Error("Queue envelope tenant does not match provider location.");
  }

  const integrationRuntime = createIntegrationRuntime("gohighlevel", {
    DB: env.DB,
    GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
    GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
    GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
  });
  const context: IntegrationContext = createIntegrationContext(
    tenant,
    "gohighlevel",
    integrationRuntime,
  );
  const ai = resolveAIProvider(env.AI, {
    provider: "hybrid",
    geminiApiKey: env.GEMINI_API_KEY,
  });
  const provider = resolveMessagingProvider(context.provider);
  const knowledgeRetriever = createTenantKnowledgeRetriever({
    ai: env.AI,
    vectorize: env.VECTORIZE_V2,
    tenantId: tenant.id,
    db: env.DB,
    topK: 20,
  });

  try {
    await processGHLInboundMessage(
      env.DB,
      context,
      ai,
      provider,
      message,
      knowledgeRetriever,
      env.AI_BOOKING_ENABLED === "true",
      (messaging, eventId, _leaseToken, renewLease) =>
        withDurableOutboundDelivery(
          env.DB,
          messaging,
          eventId,
          renewLease,
        ),
      "queue_consumer",
    );
    return null;
  } catch (error: unknown) {
    if (error instanceof InboundEventLeaseActiveError) {
      return error.retryAfterSeconds;
    }
    throw error;
  }
}

export async function consumeGHLInboundQueue(
  batch: MessageBatch<GHLInboundQueueEnvelope>,
  env: AppBindings,
): Promise<void> {
  return handleGHLInboundQueueBatch(
    batch,
    (envelope) => processEnvelope(envelope, env),
  );
}

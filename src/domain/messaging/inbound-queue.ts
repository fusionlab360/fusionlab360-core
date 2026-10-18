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
import type { GHLKnowledgeQueueEnvelope } from "./inbound-queue-contract";
import type { GHLIntegrationEventReplayEnvelope } from "./inbound-queue-contract";
import {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";
import { IntegrationEventService } from "../../core/events/service";
import { IntegrationEventProcessingError } from "../../core/events/errors";
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
import { processKnowledgeEventWithLease } from "../knowledge/queue-processing";
import { withDurableOutboundDelivery } from "./outbound-delivery";
import {
  createInboundCorrelationId,
  logInboundCheckpoint,
  logInboundExecutionPath,
  logInboundQueueReceived,
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
  workerVersion?: import("./inbound-diagnostics").WorkerVersionMetadataBinding | null,
): Promise<void> {
  await Promise.all(batch.messages.map(async (message) => {
    const envelope = message.body;
    const isInboundMessage = isQueueEnvelope(envelope) &&
      (envelope.kind === undefined || envelope.kind === "inbound");
    let correlationId: string | undefined;
    if (isInboundMessage) {
      try {
        correlationId = await createInboundCorrelationId(envelope.sourceEventId);
      } catch {
        // Diagnostics must never prevent the normal Queue processing path.
      }
    }
    const dispatchStartedAt = correlationId ? performance.now() : undefined;
    if (correlationId && dispatchStartedAt !== undefined) {
      logInboundQueueReceived(correlationId, message.timestamp, message.attempts, workerVersion);
      logInboundExecutionPath("queue_consumer", correlationId, workerVersion);
      logInboundCheckpoint("queue_dispatch", "start", correlationId, undefined, undefined, undefined, workerVersion);
    }
    try {
      const retryAfterSeconds = await processor(envelope);
      if (retryAfterSeconds !== null) {
        message.retry({ delaySeconds: retryAfterSeconds });
      } else {
        message.ack();
      }
      if (correlationId && dispatchStartedAt !== undefined) {
        logInboundCheckpoint("queue_dispatch", "complete", correlationId, dispatchStartedAt, undefined, undefined, workerVersion);
      }
    } catch (error: unknown) {
      if (correlationId && dispatchStartedAt !== undefined) {
        logInboundCheckpoint("queue_dispatch", "failed", correlationId, dispatchStartedAt, error, undefined, workerVersion);
      }
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
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== 1 ||
      typeof envelope.tenantId !== "string" ||
      envelope.provider !== "gohighlevel" ||
      typeof envelope.sourceEventId !== "string") return false;
  if (envelope.kind === "knowledge" || envelope.kind === "event_replay") return true;
  if (envelope.kind !== undefined && envelope.kind !== "inbound") return false;
  const message = envelope.message;
  if (!message || typeof message !== "object") return false;
  const inbound = message as Record<string, unknown>;
  return inbound.provider === "gohighlevel" &&
    inbound.providerMessageId === envelope.sourceEventId &&
    typeof inbound.locationId === "string" &&
    typeof inbound.conversationId === "string" &&
    typeof inbound.contactId === "string" &&
    typeof inbound.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function processKnowledgeEnvelope(
  envelope: GHLKnowledgeQueueEnvelope,
  env: AppBindings,
): Promise<number | null> {
  const eventRepository = new IntegrationEventRepository(env.DB);
  const eventService = new IntegrationEventService(eventRepository);
  const event = await eventRepository.find(envelope.tenantId, envelope.sourceEventId);
  if (!event) {
    throw new IntegrationEventProcessingError({
      code: "INVALID_EVENT",
      severity: "error",
      message: "Queued knowledge event was not found.",
      retryable: false,
    });
  }
  if (event.processingStatus === "processed") {
    return null;
  }
  return processKnowledgeEventWithLease(event, eventService, async () => {
    if (event.provider !== "gohighlevel") {
      throw new IntegrationEventProcessingError({
        code: "TENANT_CONTEXT_INVALID",
        severity: "error",
        message: "Queued knowledge event provider validation failed.",
        retryable: false,
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(event.payload) as unknown;
    } catch {
      throw new IntegrationEventProcessingError({
        code: "INVALID_EVENT",
        severity: "error",
        message: "Queued knowledge event payload is invalid.",
        retryable: false,
      });
    }
    if (!isRecord(payload) || payload.type !== event.eventType ||
        typeof payload.locationId !== "string") {
      throw new IntegrationEventProcessingError({
        code: "INVALID_EVENT",
        severity: "error",
        message: "Queued knowledge event does not match its persisted metadata.",
        retryable: false,
      });
    }

    const tenant = await resolveTenantByProviderLocation(
      env.DB,
      "gohighlevel",
      payload.locationId,
    );
    if (tenant.id !== envelope.tenantId || tenant.id !== event.tenantId) {
      throw new IntegrationEventProcessingError({
        code: "TENANT_CONTEXT_INVALID",
        severity: "error",
        message: "Queued knowledge event tenant validation failed.",
        retryable: false,
      });
    }

    const integrationRuntime = createIntegrationRuntime("gohighlevel", {
      DB: env.DB,
      GHL_OAUTH_CLIENT_ID: env.GHL_OAUTH_CLIENT_ID,
      GHL_OAUTH_CLIENT_SECRET: env.GHL_OAUTH_CLIENT_SECRET,
      GHL_OAUTH_REDIRECT_URI: env.GHL_OAUTH_REDIRECT_URI,
    });
    switch (event.eventType) {
      case "KnowledgeBaseFaqChange":
        await processGHLKnowledgeFaqWebhook(
          env.DB, env.AI, env.VECTORIZE_V2,
          payload as unknown as GHLKnowledgeFaqWebhookPayload,
          integrationRuntime,
          { skipEventPersistence: true },
        );
        break;
      case "KnowledgeBaseTrainedUrlChange":
        await processGHLKnowledgeTrainedUrlWebhook(
          env.DB,
          payload as unknown as GHLKnowledgeTrainedUrlWebhookPayload,
          integrationRuntime,
          { skipEventPersistence: true },
        );
        break;
      case "KnowledgeBaseFileChange":
      case "KnowledgeBaseRichTextChange":
      case "KnowledgeBaseTableFileChange":
        await processGHLKnowledgeAssetWebhook(
          env.DB, env.AI, env.VECTORIZE_V2,
          payload as unknown as GHLKnowledgeAssetWebhookPayload,
          integrationRuntime,
          { skipEventPersistence: true },
        );
        break;
      case "KnowledgeBaseDelete":
        await processGHLKnowledgeBaseDeleteWebhook(
          env.DB, env.AI, env.VECTORIZE_V2,
          payload as unknown as GHLKnowledgeBaseDeleteWebhookPayload,
          integrationRuntime,
          { skipEventPersistence: true },
        );
        break;
      default:
        throw new IntegrationEventProcessingError({
          code: "PROVIDER_UNSUPPORTED",
          severity: "error",
          message: "Queued knowledge event type is unsupported.",
          retryable: false,
        });
    }
  });
}

async function processPersistedEventReplay(
  envelope: GHLIntegrationEventReplayEnvelope,
  env: AppBindings,
  scheduleBackgroundTask?: (task: Promise<unknown>) => void,
): Promise<number | null> {
  const repository = new IntegrationEventRepository(env.DB);
  const event = await repository.find(envelope.tenantId, envelope.sourceEventId);
  if (!event || event.tenantId !== envelope.tenantId || event.provider !== envelope.provider) {
    throw new IntegrationEventProcessingError({
      code: "TENANT_CONTEXT_INVALID",
      severity: "error",
      message: "Persisted replay event failed tenant or provider validation.",
      retryable: false,
    });
  }
  if (event.eventType.startsWith("KnowledgeBase")) {
    return processKnowledgeEnvelope({
      version: 1,
      kind: "knowledge",
      tenantId: envelope.tenantId,
      provider: envelope.provider,
      sourceEventId: envelope.sourceEventId,
    }, env);
  }
  if (event.eventType !== "messaging.inbound") {
    throw new IntegrationEventProcessingError({
      code: "PROVIDER_UNSUPPORTED",
      severity: "error",
      message: "Persisted replay event type is not supported by this Queue consumer.",
      retryable: false,
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(event.payload) as unknown;
  } catch {
    throw new IntegrationEventProcessingError({
      code: "INVALID_EVENT",
      severity: "error",
      message: "Persisted inbound replay payload is invalid.",
      retryable: false,
    });
  }
  if (!isRecord(payload) || payload.provider !== "gohighlevel" ||
      typeof payload.providerMessageId !== "string" ||
      typeof payload.locationId !== "string" ||
      typeof payload.conversationId !== "string" ||
      typeof payload.contactId !== "string" ||
      typeof payload.text !== "string" ||
      payload.providerMessageId !== (event.externalEventId ?? event.eventId)) {
    throw new IntegrationEventProcessingError({
      code: "INVALID_EVENT",
      severity: "error",
      message: "Persisted inbound replay payload does not match its event identity.",
      retryable: false,
    });
  }
  return processEnvelope({
    version: 1,
    kind: "inbound",
    tenantId: envelope.tenantId,
    provider: "gohighlevel",
    sourceEventId: payload.providerMessageId,
    message: payload as unknown as import("../../canonical/message").CanonicalInboundMessage,
  }, env, scheduleBackgroundTask);
}

async function processEnvelope(
  rawEnvelope: GHLInboundQueueEnvelope,
  env: AppBindings,
  scheduleBackgroundTask?: (task: Promise<unknown>) => void,
): Promise<number | null> {

  if (!isQueueEnvelope(rawEnvelope)) {
    throw new Error("Invalid GHL inbound Queue envelope.");
  }

  if (rawEnvelope.kind === "knowledge") {
    return processKnowledgeEnvelope(rawEnvelope, env);
  }
  if (rawEnvelope.kind === "event_replay") {
    return processPersistedEventReplay(rawEnvelope, env, scheduleBackgroundTask);
  }

  const message = rawEnvelope.message;
  const correlationId = await createInboundCorrelationId(
    message.providerMessageId,
  );
  const tenant = await traceInboundOperation("tenant_resolution", correlationId, () => resolveTenantByProviderLocation(
    env.DB,
    "gohighlevel",
    message.locationId,
  ), env.CF_VERSION_METADATA);
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
      env.CF_VERSION_METADATA,
      env.AI_PIPELINE_V2_TENANT_ALLOWLIST,
      scheduleBackgroundTask,
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
  scheduleBackgroundTask?: (task: Promise<unknown>) => void,
): Promise<void> {
  return handleGHLInboundQueueBatch(
    batch,
    (envelope) =>
      processEnvelope(envelope, env, scheduleBackgroundTask),
    env.CF_VERSION_METADATA,
  );
}

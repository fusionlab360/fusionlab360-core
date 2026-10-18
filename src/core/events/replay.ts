import type { GHLInboundQueueEnvelope } from "../../domain/messaging/inbound-queue-contract";
import type { IntegrationEventRecord } from "../../persistence/models/integration-event";
import type { IntegrationEventRepository } from "../../persistence/repositories/integration-event-repository";
import type { IntegrationEventDeadLetterRepository } from "../../persistence/repositories/integration-event-dead-letter-repository";

const REPLAYABLE_EVENT_TYPES = new Set([
  "messaging.inbound",
  "KnowledgeBaseFaqChange",
  "KnowledgeBaseTrainedUrlChange",
  "KnowledgeBaseFileChange",
  "KnowledgeBaseRichTextChange",
  "KnowledgeBaseTableFileChange",
  "KnowledgeBaseDelete",
]);

export interface ReplayInspection {
  event: Pick<IntegrationEventRecord,
    "eventId" | "tenantId" | "eventType" | "provider" | "processingStatus" | "processingAttempts" | "lastErrorCode" | "processingLeaseExpiresAt">;
  deadLetter: { errorCode: string; retryable: boolean; attempts: number; createdAt: string } | null;
  eligible: boolean;
  reason: string;
}

export async function inspectIntegrationEventReplay(
  events: IntegrationEventRepository,
  deadLetters: IntegrationEventDeadLetterRepository,
  tenantId: string,
  eventId: string,
  now = new Date().toISOString(),
): Promise<ReplayInspection | null> {
  const event = await events.find(tenantId, eventId);
  if (!event) return null;
  const deadLetter = await deadLetters.findMetadata(tenantId, eventId);
  if (!deadLetter) {
    return {
      event: safeEvent(event),
      deadLetter: null,
      eligible: false,
      reason: "no_dead_letter_record",
    };
  }
  const recoverableDispatch = event.processingStatus === "received" && (
    event.lastErrorCode === "OPERATOR_REPLAY_ENQUEUE_FAILED" ||
    (event.lastErrorCode === "OPERATOR_REPLAY_PENDING" &&
      !!event.processingLeaseExpiresAt && event.processingLeaseExpiresAt <= now)
  );
  const eligible = event.provider === "gohighlevel" &&
    REPLAYABLE_EVENT_TYPES.has(event.eventType) &&
    (event.processingStatus === "dead_letter" || recoverableDispatch);
  return {
    event: safeEvent(event),
    deadLetter,
    eligible,
    reason: eligible ? "eligible" : event.processingStatus === "processing"
      ? "currently_processing"
      : event.processingStatus === "processed"
        ? "already_processed"
        : event.provider !== "gohighlevel" || !REPLAYABLE_EVENT_TYPES.has(event.eventType)
          ? "unsupported_provider_or_event_type"
          : "event_state_not_replayable",
  };
}

function safeEvent(event: IntegrationEventRecord): ReplayInspection["event"] {
  return {
    eventId: event.eventId,
    tenantId: event.tenantId,
    eventType: event.eventType,
    provider: event.provider,
    processingStatus: event.processingStatus,
    processingAttempts: event.processingAttempts,
    lastErrorCode: event.lastErrorCode,
    processingLeaseExpiresAt: event.processingLeaseExpiresAt,
  };
}

export async function replayDeadLetterIntegrationEvent(
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  events: IntegrationEventRepository,
  deadLetters: IntegrationEventDeadLetterRepository,
  tenantId: string,
  eventId: string,
): Promise<void> {
  const inspection = await inspectIntegrationEventReplay(
    events, deadLetters, tenantId, eventId,
  );
  if (!inspection) throw new Error("Integration event was not found for the specified tenant.");
  if (!inspection.eligible) throw new Error(`Integration event is not eligible for replay (${inspection.reason}).`);

  const leaseToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const prepared = await events.prepareDeadLetterReplay(
    tenantId, eventId, leaseToken, now, leaseExpiresAt,
  );
  if (!prepared) throw new Error("Integration event replay is already claimed or its state changed.");

  try {
    if (!queue) throw new Error("Configured Queue binding is unavailable.");
    const envelope: GHLInboundQueueEnvelope = {
      version: 1,
      kind: "event_replay",
      tenantId,
      provider: "gohighlevel",
      sourceEventId: eventId,
    };
    await queue.send(envelope);
    await events.completeDeadLetterReplayDispatch(tenantId, eventId, leaseToken);
  } catch {
    await events.failDeadLetterReplayDispatch(tenantId, eventId, leaseToken);
    throw new Error("Queue submission failed; the event remains recoverable for an explicit retry.");
  }
}

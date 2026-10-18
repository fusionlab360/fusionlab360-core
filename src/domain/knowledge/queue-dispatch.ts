import type { GHLInboundQueueEnvelope } from "../messaging/inbound-queue-contract";
import type { IntegrationEventRepository } from "../../persistence/repositories/integration-event-repository";

/** Enqueue only a tenant-scoped persisted event identity, never its payload. */
export async function enqueuePersistedKnowledgeEvent(
  queue: Queue<GHLInboundQueueEnvelope> | undefined,
  repository: IntegrationEventRepository,
  tenantId: string,
  sourceEventId: string,
): Promise<boolean> {
  const eventId = await repository.findByExternalIdentity(
    tenantId,
    "gohighlevel",
    sourceEventId,
  );
  if (!eventId) throw new Error("Persisted knowledge event could not be found for Queue dispatch.");

  const event = await repository.find(tenantId, eventId);
  if (!event || event.tenantId !== tenantId || event.provider !== "gohighlevel") {
    throw new Error("Persisted knowledge event failed tenant validation.");
  }
  if (event.processingStatus === "processed" || event.processingStatus === "dead_letter") {
    return false;
  }
  if (!queue) throw new Error("GHL inbound Queue binding is not configured.");

  await queue.send({
    version: 1,
    kind: "knowledge",
    tenantId,
    provider: "gohighlevel",
    sourceEventId: event.eventId,
  });
  return true;
}

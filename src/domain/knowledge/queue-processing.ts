import type { IntegrationEventRecord } from "../../persistence/models/integration-event";
import type { IntegrationEventService } from "../../core/events/service";

/** Claim, execute, and complete a persisted knowledge event under its D1 lease. */
export async function processKnowledgeEventWithLease(
  event: Pick<IntegrationEventRecord, "tenantId" | "eventId">,
  service: Pick<IntegrationEventService,
    "claimForProcessing" | "renewProcessingLease" | "markProcessed" | "markFailed">,
  process: (leaseToken: string) => Promise<void>,
): Promise<number | null> {
  const claim = await service.claimForProcessing(event.tenantId, event.eventId);
  if (claim.state === "active") {
    const expiresAt = claim.leaseExpiresAt ? Date.parse(claim.leaseExpiresAt) : Date.now() + 5_000;
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  }
  if (claim.state === "retryable") {
    throw new Error("Knowledge event claim could not be acquired.");
  }
  if (claim.state !== "claimed") return null;

  const leaseHeartbeat = setInterval(() => {
    void service.renewProcessingLease(event.tenantId, event.eventId, claim.leaseToken)
      .catch(() => false);
  }, 30_000);
  try {
    await process(claim.leaseToken);
    const marked = await service.markProcessed(event.tenantId, event.eventId, claim.leaseToken);
    if (!marked) throw new Error("Knowledge event lease was lost before completion.");
    return null;
  } catch (error: unknown) {
    await service.markFailed(event.tenantId, event.eventId, error, claim.leaseToken);
    throw error;
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

import { createEventId, createTenantScopedEventId } from "./id";

import type {
  IntegrationEvent,
} from "./types";

import type {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";
import type {
  IntegrationEventClaimResult,
} from "../../persistence/repositories/integration-event-repository";

import {
  getIntegrationEventRetryPolicy,
} from "./retry";

import {
  IntegrationEventProcessingError,
  type IntegrationEventErrorCode,
} from "./errors";

export interface AcceptEventResult {

  accepted:
    boolean;

  duplicate:
    boolean;

  event:
    IntegrationEvent;

}


export class IntegrationEventService {

  constructor(
  private readonly repository:
    IntegrationEventRepository,
) {}

/** Re-notify bounded durable work. Delivery claims remain the consumer's job. */
async dispatchPendingReservations(
  notify: (identity: { tenantId: string; eventId: string }) => Promise<void>,
  limit = 50,
): Promise<{ published: number; failed: number }> {
  const pending = await this.repository.findPendingReservationDispatch(limit);
  let published = 0;
  let failed = 0;
  for (const identity of pending) {
    try {
      await notify(identity);
      published++;
    } catch {
      // Do not modify event status: D1 intent survives a failed Queue send.
      failed++;
    }
  }
  return { published, failed };
}


async claimForProcessing(
  tenantId:
    string,

  eventId:
    string,
):
  Promise<IntegrationEventClaimResult> {

  const now =
    new Date().toISOString();

  const staleBefore =
    new Date(
      Date.now() -
      2 * 60 * 1000,
    ).toISOString();

  const policy =
    getIntegrationEventRetryPolicy(
      "UNKNOWN",
    );

  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const claim = await this.repository.claimForProcessing(
    tenantId,
    eventId,
    now,
    staleBefore,
    leaseToken,
    leaseExpiresAt,
    policy.maxAttempts,
  );

  return claim;
}

async renewProcessingLease(
  tenantId: string,
  eventId: string,
  leaseToken: string,
): Promise<boolean> {
  return this.repository.renewProcessingLease(
    tenantId,
    eventId,
    leaseToken,
    new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  );
}

async markProcessed(
  tenantId:
    string,

  eventId:
    string,
  leaseToken:
    string,
):
  Promise<boolean> {

  return this.repository.markProcessed(
    tenantId,
    eventId,
    new Date().toISOString(),
    leaseToken,
  );
}

async markFailed(
  tenantId:
    string,

  eventId:
    string,

  error:
    unknown,

  leaseToken:
    string,
):
  Promise<void> {

  const existing =
    await this.repository.find(
      tenantId,
      eventId,
    );

  if (!existing) {
    return;
  }

  const normalizedError =
    error instanceof
      IntegrationEventProcessingError

      ? error

      : new IntegrationEventProcessingError({
          code:
            "UNKNOWN",

          severity:
            "error",

          message:
            "Inbound event processing failed.",

          retryable:
            true,

          cause:
            error,
        });

  const code:
    IntegrationEventErrorCode =
      normalizedError.code;

  const policy =
    getIntegrationEventRetryPolicy(
      code,
    );

  const attempts =
    existing.processingAttempts ??
    0;

  const shouldDeadLetter =
    !normalizedError.retryable ||
    attempts >=
      policy.maxAttempts;

  const status =
    shouldDeadLetter
      ? "dead_letter"
      : "failed";

  await this.repository.markFailed(
    tenantId,
    eventId,
    status,
    code,
    normalizedError.message,
    leaseToken,
  );
}

  async accept<TPayload>(
    event:
      IntegrationEvent<TPayload>,
  ): Promise<
    AcceptEventResult
  > {

    const scopedEventId = await createTenantScopedEventId(
      event.tenantId,
      event.provider,
      event.eventId,
    );

    const legacyEventId = await this.repository.findByExternalIdentity(
      event.tenantId,
      event.provider,
      event.eventId,
    );

    if (legacyEventId) {
      return {
        accepted: false,
        duplicate: true,
        event: { ...event, eventId: legacyEventId },
      };
    }

    // ----------------------------------------------------------
    // Atomically persist the event if this eventId
    // has not already been accepted.
    //
    // This prevents the race condition:
    //
    // has()
    //   ↓
    // create()
    //
    // where two simultaneous requests can both
    // observe "not found".
    // ----------------------------------------------------------

    const inserted =
      await this.repository
        .createIfAbsent({

          eventId:
            scopedEventId,

          externalEventId:
            event.eventId,

          idempotencyKey:
            scopedEventId,

          tenantId:
            event.tenantId,

          eventType:
            event.eventType,

          aggregateType:
            event.aggregateType,

          aggregateId:
            event.aggregateId,

          provider:
            event.provider,

          revision:
            event.revision,

          occurredAt:
            event.occurredAt,

          receivedAt:
            new Date().toISOString(),

          payload:
            JSON.stringify(
              event.payload,
            ),

        });

    const storedEventId = inserted
      ? scopedEventId
      : await this.repository.findByExternalIdentity(
          event.tenantId,
          event.provider,
          event.eventId,
        );

    if (!storedEventId) {
      throw new Error("Integration event could not be durably identified.");
    }


    // ----------------------------------------------------------
    // Duplicate event
    // ----------------------------------------------------------

    if (!inserted) {

      return {

        accepted:
          false,

        duplicate:
          true,

          event: { ...event, eventId: storedEventId },

      };

    }


    // ----------------------------------------------------------
    // First accepted occurrence
    // ----------------------------------------------------------

    return {

      accepted:
        true,

      duplicate:
        false,

        event: { ...event, eventId: storedEventId },

    };

  }


  // ------------------------------------------------------------
  // Generate an ID for Core-created events.
  // ------------------------------------------------------------

  createId():
    string {

    return createEventId();

  }

}

import { createEventId } from "./id";

import type {
  IntegrationEvent,
} from "./types";

import type {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";

import {
  IntegrationEventDeadLetterRepository,
} from "../../persistence/repositories/integration-event-dead-letter-repository";

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

  private readonly deadLetterRepository?:
    IntegrationEventDeadLetterRepository,
) {}


async claimForProcessing(
  tenantId:
    string,

  eventId:
    string,
):
  Promise<boolean> {

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

  return this.repository.claimForProcessing(
    tenantId,
    eventId,
    now,
    staleBefore,
    policy.maxAttempts,
  );
}

async markProcessed(
  tenantId:
    string,

  eventId:
    string,
):
  Promise<void> {

  await this.repository.markProcessed(
    tenantId,
    eventId,
    new Date().toISOString(),
  );
}

async markFailed(
  tenantId:
    string,

  eventId:
    string,

  error:
    unknown,
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
            error instanceof Error
              ? error.message
              : String(error),

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
  );

  if (
    shouldDeadLetter &&
    this.deadLetterRepository
  ) {

    await this.deadLetterRepository.create({
      eventId,

      tenantId,

      errorCode:
        code,

      errorMessage:
        normalizedError.message,

      retryable:
        normalizedError.retryable,

      attempts,

      payload:
        existing.payload,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    });
  }
}

  async accept<TPayload>(
    event:
      IntegrationEvent<TPayload>,
  ): Promise<
    AcceptEventResult
  > {

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
            event.eventId,

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


    // ----------------------------------------------------------
    // Duplicate event
    // ----------------------------------------------------------

    if (!inserted) {

      return {

        accepted:
          false,

        duplicate:
          true,

        event,

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

      event,

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
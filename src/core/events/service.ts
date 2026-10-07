import { createEventId } from "./id";

import type {
  IntegrationEvent,
} from "./types";

import type {
  IntegrationEventRepository,
} from "../../persistence/repositories/integration-event-repository";


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
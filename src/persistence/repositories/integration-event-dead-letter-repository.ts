import { BaseRepository } from "./base-repository";

import type {
  IntegrationEventDeadLetter,
} from "../models/integration-event-dead-letter";


export class IntegrationEventDeadLetterRepository
  extends BaseRepository {


  async create(
    deadLetter:
      IntegrationEventDeadLetter,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO integration_event_dead_letters (

          event_id,
          tenant_id,
          error_code,
          error_message,
          retryable,
          attempts,
          payload

        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(

        deadLetter.eventId,

        deadLetter.tenantId,

        deadLetter.errorCode,

        deadLetter.errorMessage,

        deadLetter.retryable
          ? 1
          : 0,

        deadLetter.attempts,

        deadLetter.payload,

      )
      .run();

  }

}
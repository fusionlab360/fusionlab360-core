import { BaseRepository } from "./base-repository";

import type {
  IntegrationEventDeadLetter,
} from "../models/integration-event-dead-letter";


export class IntegrationEventDeadLetterRepository
  extends BaseRepository {

  async findMetadata(
    tenantId: string,
    eventId: string,
  ): Promise<{
    errorCode: string;
    retryable: boolean;
    attempts: number;
    createdAt: string;
  } | null> {
    const row = await this.db.prepare(`
      SELECT error_code, retryable, attempts, created_at
      FROM integration_event_dead_letters
      WHERE tenant_id = ? AND event_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(tenantId, eventId).first<{
      error_code: string;
      retryable: number;
      attempts: number;
      created_at: string;
    }>();
    return row ? {
      errorCode: row.error_code,
      retryable: row.retryable === 1,
      attempts: row.attempts,
      createdAt: row.created_at,
    } : null;
  }


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

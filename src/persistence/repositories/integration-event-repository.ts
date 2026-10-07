import { BaseRepository } from "./base-repository";
import type {
  IntegrationEventRecord,
} from "../models/integration-event";

export class IntegrationEventRepository
  extends BaseRepository {

  async find(
  tenantId: string,
  eventId: string,
): Promise<IntegrationEventRecord | null> {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM integration_events
          WHERE tenant_id = ?
          AND event_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          eventId,
        )
        .first<{
          event_id: string;
          tenant_id: string;
          event_type: string;
          aggregate_type: string;
          aggregate_id: string;
          provider: string | null;
          revision: number | null;
          occurred_at: string;
          received_at: string;
          payload: string;
        }>();


    if (!result) {
      return null;
    }


    return {

      eventId:
        result.event_id,

      tenantId:
        result.tenant_id,

      eventType:
        result.event_type,

      aggregateType:
        result.aggregate_type,

      aggregateId:
        result.aggregate_id,

      provider:
        result.provider ??
        undefined,
   
      revision:
        result.revision ??
        undefined,

      occurredAt:
        result.occurred_at,

      receivedAt:
        result.received_at,

      payload:
        result.payload,

    };

  }


  // ============================================================
  // Idempotency check
  // ============================================================

  async has(
  tenantId: string,
  eventId: string,
): Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          SELECT 1
          FROM integration_events
          WHERE tenant_id = ?
          AND event_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          eventId,
        )
        .first();

    return Boolean(
      result,
    );

  }


  // ============================================================
  // Atomically create an event if it does not already exist
  // ============================================================

  async createIfAbsent(
    event: IntegrationEventRecord,
  ): Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          INSERT OR IGNORE INTO integration_events (

            event_id,
            tenant_id,
            event_type,
            aggregate_type,
            aggregate_id,
            provider,
            revision,
            occurred_at,
            received_at,
            payload

)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(

            event.eventId,

            event.tenantId,

            event.eventType,

            event.aggregateType,

            event.aggregateId,

            event.provider ??
                null,

            event.revision ??
                null,

            event.occurredAt,

            event.receivedAt,

            event.payload,

        )

        .run();

    return (
      result.meta.changes === 1
    );

  }


  // ============================================================
  // Create reservation/event record
  // ============================================================

  async create(
    event: IntegrationEventRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO integration_events (

        event_id,
        tenant_id,
        event_type,
        aggregate_type,
        aggregate_id,
        provider,
        revision,
        occurred_at,
        received_at,
        payload

        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(

        event.eventId,

        event.tenantId,

        event.eventType,

        event.aggregateType,

        event.aggregateId,

        event.provider ??
        null,

        event.revision ??
        null,

        event.occurredAt,

        event.receivedAt,

        event.payload,

      )
      .run();

  }

}
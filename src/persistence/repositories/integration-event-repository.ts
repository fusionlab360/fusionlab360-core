import { BaseRepository } from "./base-repository";
import type {
  IntegrationEventRecord,
} from "../models/integration-event";
import { createTenantScopedEventId } from "../../core/events/id";

export type IntegrationEventClaimResult =
  | { state: "claimed"; leaseToken: string; leaseExpiresAt: string }
  | { state: "processed" }
  | { state: "active"; leaseExpiresAt: string | null }
  | { state: "exhausted" }
  | { state: "retryable" }
  | { state: "terminal" };

export class IntegrationEventRepository
  extends BaseRepository {

  /**
   * Must immediately follow a reservation write in the SAME D1 batch.
   * changes() gates emission on that write, including conditional zero-row updates.
   * The canonical ID is read inside the transaction, never guessed by the caller.
   */
  async prepareReservationIntent(
    record: import("../models/reservation-record").ReservationRecord & {
      providerConnectionId: string; providerPropertyId: string;
    },
    destinationIntegrationId: string,
    eventType: string,
  ): Promise<{ statement: D1PreparedStatement; eventId: string }> {
    // This unique provider scope identifies exactly one canonical reservation,
    // including when concurrent inserts propose different canonical UUIDs.
    const externalId = JSON.stringify([
      "reservation", record.providerConnectionId, record.providerPropertyId,
      record.providerReservationId, record.revision, eventType, destinationIntegrationId,
    ]);
    const eventId = await createTenantScopedEventId(record.tenantId, record.provider, externalId);
    const statement = this.db.prepare(`
      INSERT INTO integration_events (
        event_id, tenant_id, event_type, aggregate_type, aggregate_id,
        provider, revision, occurred_at, received_at, payload,
        external_event_id, idempotency_key
      )
      SELECT ?, tenant_id, ?, 'reservation', canonical_reservation_id,
        provider, revision, ?, ?,
        json_object('canonicalReservationId', canonical_reservation_id,
          'sourceIntegrationId', provider_connection_id, 'destinationIntegrationId', ?),
        ?, ?
      FROM reservation_records
      WHERE changes() = 1 AND tenant_id = ? AND provider = ?
        AND provider_connection_id = ? AND provider_property_id = ?
        AND provider_reservation_id = ? AND revision = ?
      ON CONFLICT(event_id) DO NOTHING
    `).bind(
      eventId, eventType, record.updatedAt, new Date().toISOString(),
      destinationIntegrationId, externalId, eventId,
      record.tenantId, record.provider, record.providerConnectionId,
      record.providerPropertyId, record.providerReservationId, record.revision,
    );
    return { statement, eventId };
  }

  /** Bounded, identity-only recovery; dead letters and active leases are excluded. */
  async findPendingReservationDispatch(limit = 50): Promise<Array<{ tenantId: string; eventId: string }>> {
    const rows = await this.db.prepare(`
      SELECT tenant_id, event_id FROM integration_events
      WHERE aggregate_type = 'reservation'
        AND event_type IN ('reservation.created','reservation.updated',
          'reservation.cancelled','reservation.checked_in','reservation.checked_out')
        AND (
          processing_status IN ('received', 'failed')
          OR (processing_status = 'processing'
            AND COALESCE(julianday(processing_lease_expires_at),
              julianday(processing_started_at, '+2 minutes')) <= julianday('now'))
        )
      ORDER BY received_at ASC, event_id ASC LIMIT ?
    `).bind(Math.max(1, Math.min(50, Math.trunc(limit) || 50)))
      .all<{ tenant_id: string; event_id: string }>();
    return (rows.results ?? []).map(row => ({ tenantId: row.tenant_id, eventId: row.event_id }));
  }

  /**
   * Fence Queue publication separately from event processing. A source-webhook
   * retry may resume only a failed or expired Queue dispatch; it cannot create
   * another active dispatch for the same durable event.
   */
  async prepareQueueDispatch(
    tenantId: string,
    eventId: string,
    leaseToken: string,
    now: string,
    leaseExpiresAt: string,
    allowInitialDispatch: boolean,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_started_at = ?,
          processing_lease_token = ?,
          processing_lease_expires_at = ?,
          last_error_code = 'QUEUE_DISPATCH_PENDING',
          last_error_message = 'Queue dispatch is pending confirmation.'
      WHERE tenant_id = ? AND event_id = ?
        AND processing_status = 'received'
        AND (
          (? = 1 AND last_error_code IS NULL)
          OR last_error_code = 'QUEUE_ENQUEUE_FAILED'
          OR (
            last_error_code = 'QUEUE_DISPATCH_PENDING'
            AND processing_lease_expires_at IS NOT NULL
            AND processing_lease_expires_at <= ?
          )
        )
    `).bind(
      now,
      leaseToken,
      leaseExpiresAt,
      tenantId,
      eventId,
      allowInitialDispatch ? 1 : 0,
      now,
    ).run();
    return result.meta.changes === 1;
  }

  async completeQueueDispatch(
    tenantId: string,
    eventId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_started_at = NULL,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_error_code = NULL,
          last_error_message = NULL
      WHERE tenant_id = ? AND event_id = ?
        AND processing_status = 'received'
        AND last_error_code = 'QUEUE_DISPATCH_PENDING'
        AND processing_lease_token = ?
    `).bind(tenantId, eventId, leaseToken).run();
    return result.meta.changes === 1;
  }

  async failQueueDispatch(
    tenantId: string,
    eventId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_started_at = NULL,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_error_code = 'QUEUE_ENQUEUE_FAILED',
          last_error_message = 'Queue dispatch could not be confirmed.'
      WHERE tenant_id = ? AND event_id = ?
        AND processing_status = 'received'
        AND last_error_code = 'QUEUE_DISPATCH_PENDING'
        AND processing_lease_token = ?
    `).bind(tenantId, eventId, leaseToken).run();
    return result.meta.changes === 1;
  }

  async prepareDeadLetterReplay(
    tenantId: string,
    eventId: string,
    leaseToken: string,
    now: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_status = 'received',
          processing_attempts = 0,
          processing_started_at = ?,
          processed_at = NULL,
          processing_lease_token = ?,
          processing_lease_expires_at = ?,
          last_error_code = 'OPERATOR_REPLAY_PENDING',
          last_error_message = 'Operator replay dispatch is pending.'
      WHERE tenant_id = ? AND event_id = ?
        AND EXISTS (
          SELECT 1 FROM integration_event_dead_letters d
          WHERE d.tenant_id = integration_events.tenant_id
            AND d.event_id = integration_events.event_id
        )
        AND (
          processing_status = 'dead_letter'
          OR (processing_status = 'received'
            AND last_error_code = 'OPERATOR_REPLAY_ENQUEUE_FAILED')
          OR (processing_status = 'received'
            AND last_error_code = 'OPERATOR_REPLAY_PENDING'
            AND processing_lease_expires_at <= ?)
        )
    `).bind(now, leaseToken, leaseExpiresAt, tenantId, eventId, now).run();
    return result.meta.changes === 1;
  }

  async completeDeadLetterReplayDispatch(
    tenantId: string,
    eventId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_started_at = NULL,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_error_code = NULL,
          last_error_message = NULL
      WHERE tenant_id = ? AND event_id = ?
        AND processing_status = 'received'
        AND last_error_code = 'OPERATOR_REPLAY_PENDING'
        AND processing_lease_token = ?
    `).bind(tenantId, eventId, leaseToken).run();
    return result.meta.changes === 1;
  }

  async failDeadLetterReplayDispatch(
    tenantId: string,
    eventId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE integration_events
      SET processing_started_at = NULL,
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          last_error_code = 'OPERATOR_REPLAY_ENQUEUE_FAILED',
          last_error_message = 'Operator replay could not be confirmed as queued.'
      WHERE tenant_id = ? AND event_id = ?
        AND processing_status = 'received'
        AND last_error_code = 'OPERATOR_REPLAY_PENDING'
        AND processing_lease_token = ?
    `).bind(tenantId, eventId, leaseToken).run();
    return result.meta.changes === 1;
  }

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
          processing_status: string;
          processing_attempts: number;
          processing_started_at: string | null;
          processed_at: string | null;
          last_error_code: string | null;
          last_error_message: string | null;
          external_event_id: string | null;
          idempotency_key: string | null;
          processing_lease_token: string | null;
          processing_lease_expires_at: string | null;
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

      processingStatus: result.processing_status as IntegrationEventRecord["processingStatus"],
      processingAttempts: result.processing_attempts,
      processingStartedAt: result.processing_started_at,
      processedAt: result.processed_at,
      lastErrorCode: result.last_error_code,
      lastErrorMessage: result.last_error_message,

      externalEventId: result.external_event_id,
      idempotencyKey: result.idempotency_key,
      processingLeaseToken: result.processing_lease_token,
      processingLeaseExpiresAt: result.processing_lease_expires_at,

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

  async findByExternalIdentity(
    tenantId: string,
    provider: string | undefined,
    externalEventId: string,
  ): Promise<string | null> {
    const result = await this.db
      .prepare(`
        SELECT event_id
        FROM integration_events
        WHERE tenant_id = ?
          AND COALESCE(provider, '') = COALESCE(?, '')
          AND (
            external_event_id = ?
            OR (external_event_id IS NULL AND event_id = ?)
          )
        LIMIT 1
      `)
      .bind(tenantId, provider ?? null, externalEventId, externalEventId)
      .first<{ event_id: string }>();

    return result?.event_id ?? null;
  }


  // ============================================================
  // Atomically create an event if it does not already exist
  // ============================================================

  async createIfAbsent(
    event: IntegrationEventRecord,
  ): Promise<boolean> {

    const externalEventId = event.externalEventId ?? event.eventId;
    const idempotencyKey = event.idempotencyKey ?? await createTenantScopedEventId(
      event.tenantId,
      event.provider,
      externalEventId,
    );
    const storageEventId = event.idempotencyKey
      ? event.eventId
      : idempotencyKey;

    if (await this.findByExternalIdentity(
      event.tenantId,
      event.provider,
      externalEventId,
    )) {
      return false;
    }

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
            payload,
            external_event_id,
            idempotency_key
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(

            storageEventId,

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

            externalEventId,

            idempotencyKey,

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

  //

  async claimForProcessing(
  tenantId:
    string,

  eventId:
    string,

  now:
    string,

  staleBefore:
    string,

  leaseToken:
    string,

  leaseExpiresAt:
    string,

  maxAttempts:
    number,
):
  Promise<IntegrationEventClaimResult> {

  const result =
    await this.db
      .prepare(
        `
        UPDATE integration_events
        SET
          processing_status =
            'processing',

          processing_attempts =
            processing_attempts + 1,

          processing_started_at =
            ?,

          processing_lease_token = ?,

          processing_lease_expires_at = ?,

          processed_at =
            NULL,

          last_error_code =
            NULL,

          last_error_message =
            NULL

        WHERE tenant_id =
          ?

          AND event_id =
          ?

          AND processing_attempts <
          ?

          AND (
            processing_status IN
              ('received', 'failed')

            OR (
              processing_status =
                'processing'

              AND (
                (processing_lease_expires_at IS NOT NULL
                  AND processing_lease_expires_at <= ?)
                OR (processing_lease_expires_at IS NULL
                  AND (processing_started_at IS NULL
                    OR processing_started_at <= ?))
              )
            )
          )
        `,
      )
      .bind(
        now,
        leaseToken,
        leaseExpiresAt,
        tenantId,
        eventId,
        maxAttempts,
        now,
        staleBefore,
      )
      .run();

  if (result.meta.changes === 1) {
    return { state: "claimed", leaseToken, leaseExpiresAt };
  }

  const existing = await this.db
    .prepare(`
      SELECT processing_status, processing_attempts,
             processing_lease_expires_at, processing_started_at
      FROM integration_events
      WHERE tenant_id = ? AND event_id = ?
      LIMIT 1
    `)
    .bind(tenantId, eventId)
    .first<{
      processing_status: string;
      processing_attempts: number;
      processing_lease_expires_at: string | null;
      processing_started_at: string | null;
    }>();

  if (!existing) return { state: "terminal" };
  if (existing.processing_status === "processed") return { state: "processed" };
  if (existing.processing_status === "dead_letter") {
    await this.ensureDeadLetterRecord(tenantId, eventId);
    return { state: "terminal" };
  }
  if (existing.processing_attempts >= maxAttempts) {
    if (existing.processing_status !== "dead_letter") {
      const exhausted = await this.persistExhaustedDeadLetter(
        tenantId,
        eventId,
        maxAttempts,
        now,
        staleBefore,
      );
      if (exhausted) return { state: "exhausted" };
    }
    if (existing.processing_status === "processing") {
      return {
        state: "active",
        leaseExpiresAt: existing.processing_lease_expires_at ?? existing.processing_started_at,
      };
    }
    return { state: "terminal" };
  }
  if (existing.processing_status === "processing") {
    return {
      state: "active",
      leaseExpiresAt: existing.processing_lease_expires_at ?? existing.processing_started_at,
    };
  }

  return { state: "retryable" };
}

//
async markProcessed(
  tenantId:
    string,

  eventId:
    string,

  processedAt:
    string,

  leaseToken:
    string,
):
  Promise<boolean> {
  const result = await this.db
    .prepare(
      `
      UPDATE integration_events
      SET
        processing_status = 'processed',
        processing_started_at = NULL,
        processed_at = ?,
        processing_lease_token = NULL,
        processing_lease_expires_at = NULL,
        last_error_code = NULL,
        last_error_message = NULL
      WHERE tenant_id = ?
        AND event_id = ?
        AND processing_status = 'processing'
        AND processing_lease_token = ?
      `,
    )
    .bind(
      processedAt,
      tenantId,
      eventId,
      leaseToken,
    )
    .run();

  return result.meta.changes === 1;
}

private async persistExhaustedDeadLetter(
  tenantId: string,
  eventId: string,
  maxAttempts: number,
  now: string,
  staleBefore: string,
): Promise<boolean> {
  const results = await this.db.batch([
    this.db.prepare(`
      UPDATE integration_events
      SET processing_status = 'dead_letter',
          processing_lease_token = NULL,
          processing_lease_expires_at = NULL,
          processing_started_at = NULL,
          last_error_code = 'ATTEMPTS_EXHAUSTED',
          last_error_message = 'Inbound event processing attempts exhausted.'
      WHERE tenant_id = ? AND event_id = ?
        AND processing_attempts >= ?
        AND processing_status IN ('failed', 'processing')
        AND (
          processing_lease_expires_at <= ?
          OR (processing_lease_expires_at IS NULL
            AND (processing_started_at IS NULL OR processing_started_at <= ?))
        )
    `).bind(tenantId, eventId, maxAttempts, now, staleBefore),
    this.db.prepare(`
      INSERT INTO integration_event_dead_letters (
        event_id, tenant_id, error_code, error_message,
        retryable, attempts, payload
      )
      SELECT e.event_id, e.tenant_id, e.last_error_code,
             e.last_error_message, 0, e.processing_attempts, e.payload
      FROM integration_events AS e
      WHERE e.tenant_id = ? AND e.event_id = ?
        AND e.processing_status = 'dead_letter'
        AND e.last_error_code = 'ATTEMPTS_EXHAUSTED'
        AND NOT EXISTS (
          SELECT 1 FROM integration_event_dead_letters AS d
          WHERE d.tenant_id = e.tenant_id
            AND d.event_id = e.event_id
            AND d.error_code = e.last_error_code
        )
    `).bind(tenantId, eventId),
  ]);
  return results[0]?.meta.changes === 1;
}

private async ensureDeadLetterRecord(
  tenantId: string,
  eventId: string,
): Promise<void> {
  await this.db.prepare(`
    INSERT INTO integration_event_dead_letters (
      event_id, tenant_id, error_code, error_message,
      retryable, attempts, payload
    )
    SELECT e.event_id, e.tenant_id, e.last_error_code,
           e.last_error_message, 0, e.processing_attempts, e.payload
    FROM integration_events AS e
    WHERE e.tenant_id = ? AND e.event_id = ?
      AND e.processing_status = 'dead_letter'
      AND e.last_error_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM integration_event_dead_letters AS d
        WHERE d.tenant_id = e.tenant_id
          AND d.event_id = e.event_id
          AND d.error_code = e.last_error_code
      )
  `).bind(tenantId, eventId).run();
}

//
async markFailed(
  tenantId:
    string,

  eventId:
    string,

  status:
    "failed" |
    "dead_letter",

  errorCode:
    string,

  errorMessage:
    string,

  leaseToken:
    string,
):
  Promise<boolean> {

  if (status === "dead_letter") {
    const results = await this.db.batch([
      this.db.prepare(`
        UPDATE integration_events
        SET processing_status = 'dead_letter',
            processing_started_at = NULL,
            processing_lease_token = NULL,
            processing_lease_expires_at = NULL,
            last_error_code = ?,
            last_error_message = ?
        WHERE tenant_id = ? AND event_id = ?
          AND processing_status = 'processing'
          AND processing_lease_token = ?
      `).bind(errorCode, errorMessage, tenantId, eventId, leaseToken),
      this.db.prepare(`
        INSERT INTO integration_event_dead_letters (
          event_id, tenant_id, error_code, error_message,
          retryable, attempts, payload
        )
        SELECT e.event_id, e.tenant_id, e.last_error_code,
               e.last_error_message, 0, e.processing_attempts, e.payload
        FROM integration_events AS e
        WHERE e.tenant_id = ? AND e.event_id = ?
          AND e.processing_status = 'dead_letter'
          AND e.last_error_code = ?
          AND NOT EXISTS (
            SELECT 1 FROM integration_event_dead_letters AS d
            WHERE d.tenant_id = e.tenant_id
              AND d.event_id = e.event_id
              AND d.error_code = e.last_error_code
          )
      `).bind(tenantId, eventId, errorCode),
    ]);
    return results[0]?.meta.changes === 1;
  }

  const result = await this.db
    .prepare(
      `
      UPDATE integration_events
      SET
        processing_status = ?,
        processing_started_at = NULL,
        processing_lease_token = NULL,
        processing_lease_expires_at = NULL,
        last_error_code = ?,
        last_error_message = ?
      WHERE tenant_id = ?
        AND event_id = ?
        AND processing_status = 'processing'
        AND processing_lease_token = ?
      `,
    )
    .bind(
      status,
      errorCode,
      errorMessage,
      tenantId,
      eventId,
      leaseToken,
    )
    .run();

  return result.meta.changes === 1;
}

async renewProcessingLease(
  tenantId: string,
  eventId: string,
  leaseToken: string,
  leaseExpiresAt: string,
): Promise<boolean> {
  const result = await this.db.prepare(`
    UPDATE integration_events
    SET processing_lease_expires_at = ?
    WHERE tenant_id = ? AND event_id = ?
      AND processing_status = 'processing'
      AND processing_lease_token = ?
  `).bind(leaseExpiresAt, tenantId, eventId, leaseToken).run();

  return result.meta.changes === 1;
}

async findRetryable(
  limit:
    number,
  maxAttempts = 5,
):
  Promise<IntegrationEventRecord[]> {

  const rows =
    await this.db
      .prepare(
        `
        SELECT
          event_id,
          tenant_id,
          event_type,
          aggregate_type,
          aggregate_id,
          provider,
          revision,
          occurred_at,
          received_at,
          payload,
          processing_status,
          processing_attempts,
          processing_started_at,
          processed_at,
          last_error_code,
          last_error_message
        FROM integration_events
        WHERE
          processing_status IN
            ('failed', 'processing')
          AND processing_attempts < ?
          AND (processing_status = 'failed'
            OR (processing_lease_expires_at IS NOT NULL
              AND julianday(processing_lease_expires_at) <= julianday('now'))
            OR (processing_lease_expires_at IS NULL
              AND julianday(processing_started_at) <= julianday('now', '-2 minutes')))
        ORDER BY received_at ASC
        LIMIT ?
        `,
      )
      .bind(
        maxAttempts,
        limit,
      )
      .all<{
        event_id:
          string;

        tenant_id:
          string;

        event_type:
          string;

        aggregate_type:
          string;

        aggregate_id:
          string;

        provider:
          string | null;

        revision:
          number | null;

        occurred_at:
          string;

        received_at:
          string;

        payload:
          string;

        processing_status:
          string;

        processing_attempts:
          number;

        processing_started_at:
          string | null;

        processed_at:
          string | null;

        last_error_code:
          string | null;

        last_error_message:
          string | null;
      }>();

  return (
    rows.results ??
    []
  ).map(
    (
      row,
    ) => ({
      eventId:
        row.event_id,

      tenantId:
        row.tenant_id,

      eventType:
        row.event_type,

      aggregateType:
        row.aggregate_type,

      aggregateId:
        row.aggregate_id,

      provider:
        row.provider ??
        undefined,

      revision:
        row.revision ??
        undefined,

      occurredAt:
        row.occurred_at,

      receivedAt:
        row.received_at,

      payload:
        row.payload,

      processingStatus:
        row.processing_status as
          IntegrationEventRecord[
            "processingStatus"
          ],

      processingAttempts:
        row.processing_attempts,

      processingStartedAt:
        row.processing_started_at,

      processedAt:
        row.processed_at,

      lastErrorCode:
        row.last_error_code,

      lastErrorMessage:
        row.last_error_message,
    }),
  );
}

}


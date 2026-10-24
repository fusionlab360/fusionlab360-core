import { BaseRepository } from "./base-repository";
import { IntegrationEventRepository } from "./integration-event-repository";

import type {
  ReservationRecord,
} from "../models/reservation-record";


export class ReservationRecordRepository
  extends BaseRepository {

  /** Atomic canonical write and durable intent; Queue notification is separate. */
  async persistProviderReservationWithEvent(
    record: ReservationRecord & { providerConnectionId: string; providerPropertyId: string },
    destinationIntegrationId: string,
  ): Promise<{
    outcome: "inserted" | "updated" | "unchanged" | "stale" | "conflict";
    eventId?: string;
  }> {
    const events = new IntegrationEventRepository(this.db);
    const insertedType = record.lifecycle === "cancelled" ? "reservation.cancelled" : "reservation.created";
    const updatedType = record.lifecycle === "cancelled" ? "reservation.cancelled"
      : record.lifecycle === "checked_in" ? "reservation.checked_in"
      : record.lifecycle === "checked_out" ? "reservation.checked_out" : "reservation.updated";
    const insertEvent = await events.prepareReservationIntent(record, destinationIntegrationId, insertedType);
    const updateEvent = await events.prepareReservationIntent(record, destinationIntegrationId, updatedType);
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT INTO reservation_records (
          tenant_id, canonical_reservation_id, provider, provider_reservation_id,
          provider_connection_id, provider_property_id, provider_calendar_id,
          provider_edit_id, revision, lifecycle, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, provider, provider_connection_id,
          provider_property_id, provider_reservation_id)
          WHERE provider_connection_id IS NOT NULL AND provider_property_id IS NOT NULL
        DO NOTHING
      `).bind(record.tenantId, record.canonicalReservationId, record.provider,
        record.providerReservationId, record.providerConnectionId, record.providerPropertyId,
        record.providerCalendarId ?? null, record.providerEditId ?? null,
        record.revision, record.lifecycle, record.payload),
      insertEvent.statement,
      this.db.prepare(`
        UPDATE reservation_records SET provider_calendar_id = ?, provider_edit_id = ?,
          revision = ?, lifecycle = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND provider = ? AND provider_connection_id = ?
          AND provider_property_id = ? AND provider_reservation_id = ? AND revision < ?
      `).bind(record.providerCalendarId ?? null, record.providerEditId ?? null,
        record.revision, record.lifecycle, record.payload, record.tenantId, record.provider,
        record.providerConnectionId, record.providerPropertyId, record.providerReservationId,
        record.revision),
      updateEvent.statement,
    ]);
    if (results[0].meta.changes === 1) return { outcome: "inserted", eventId: insertEvent.eventId };
    if (results[2].meta.changes === 1) return { outcome: "updated", eventId: updateEvent.eventId };
    const existing = await this.db.prepare(`
      SELECT revision, lifecycle, payload FROM reservation_records
      WHERE tenant_id = ? AND provider = ? AND provider_connection_id = ?
        AND provider_property_id = ? AND provider_reservation_id = ?
    `).bind(record.tenantId, record.provider, record.providerConnectionId,
      record.providerPropertyId, record.providerReservationId)
      .first<{ revision: number; lifecycle: string; payload: string }>();
    if (existing && existing.revision > record.revision) return { outcome: "stale" };
    return { outcome: existing?.revision === record.revision && existing.lifecycle === record.lifecycle &&
      existing.payload === record.payload ? "unchanged" : "conflict" };
  }

  async persistProviderReservation(
    record: ReservationRecord & {
      providerConnectionId: string;
      providerPropertyId: string;
    },
  ): Promise<"inserted" | "updated" | "unchanged" | "stale" | "conflict"> {
    const result = await this.db.prepare(`
      INSERT INTO reservation_records (
        tenant_id, canonical_reservation_id, provider,
        provider_reservation_id, provider_connection_id,
        provider_property_id, provider_calendar_id, provider_edit_id,
        revision, lifecycle, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (
        tenant_id, provider, provider_connection_id,
        provider_property_id, provider_reservation_id
      ) WHERE provider_connection_id IS NOT NULL
        AND provider_property_id IS NOT NULL
      DO UPDATE SET
        provider_calendar_id = excluded.provider_calendar_id,
        provider_edit_id = excluded.provider_edit_id,
        revision = excluded.revision,
        lifecycle = excluded.lifecycle,
        payload = excluded.payload,
        updated_at = CURRENT_TIMESTAMP
      WHERE reservation_records.revision < excluded.revision
    `).bind(
      record.tenantId,
      record.canonicalReservationId,
      record.provider,
      record.providerReservationId,
      record.providerConnectionId,
      record.providerPropertyId,
      record.providerCalendarId ?? null,
      record.providerEditId ?? null,
      record.revision,
      record.lifecycle,
      record.payload,
    ).run();

    if (result.meta.changes === 1) {
      const existing = await this.db.prepare(`
        SELECT canonical_reservation_id
        FROM reservation_records
        WHERE tenant_id = ? AND provider = ?
          AND provider_connection_id = ? AND provider_property_id = ?
          AND provider_reservation_id = ?
      `).bind(
        record.tenantId,
        record.provider,
        record.providerConnectionId,
        record.providerPropertyId,
        record.providerReservationId,
      ).first<{ canonical_reservation_id: string }>();
      return existing?.canonical_reservation_id === record.canonicalReservationId
        ? "inserted"
        : "updated";
    }

    const existing = await this.db.prepare(`
      SELECT canonical_reservation_id, revision, lifecycle, payload
      FROM reservation_records
      WHERE tenant_id = ? AND provider = ?
        AND provider_connection_id = ? AND provider_property_id = ?
        AND provider_reservation_id = ?
    `).bind(
      record.tenantId,
      record.provider,
      record.providerConnectionId,
      record.providerPropertyId,
      record.providerReservationId,
    ).first<{
      canonical_reservation_id: string;
      revision: number;
      lifecycle: string;
      payload: string;
    }>();
    if (!existing) return "conflict";
    if (existing.revision > record.revision) return "stale";
    return existing.revision === record.revision &&
      existing.lifecycle === record.lifecycle &&
      existing.payload === record.payload
      ? "unchanged"
      : "conflict";
  }

  // ============================================================
  // Find canonical reservation
  // ============================================================

  async find(
    tenantId: string,
    canonicalReservationId: string,
  ): Promise<ReservationRecord | null> {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_records
          WHERE
            tenant_id = ?
            AND canonical_reservation_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          canonicalReservationId,
        )
        .first<{
          tenant_id: string;
          canonical_reservation_id: string;

          provider: string;

          provider_connection_id: string | null;

          provider_property_id: string | null;

          provider_reservation_id: string;

          provider_calendar_id:
            string | null;

          provider_edit_id:
            string | null;

          revision: number;

          lifecycle: string;

          payload: string;

          created_at: string;

          updated_at: string;
        }>();


    if (!result) {
      return null;
    }


    return {

      tenantId:
        result.tenant_id,

      canonicalReservationId:
        result.canonical_reservation_id,

      provider:
        result.provider,

      providerConnectionId:
        result.provider_connection_id ??
        undefined,

      providerPropertyId:
        result.provider_property_id ??
        undefined,

      providerReservationId:
        result.provider_reservation_id,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision,

      lifecycle:
        result.lifecycle,

      payload:
        result.payload,

      createdAt:
        result.created_at,

      updatedAt:
        result.updated_at,

    };

  }


  // ============================================================
  // Create canonical reservation record
  // ============================================================

  async create(
    record: ReservationRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO reservation_records (

          tenant_id,
          canonical_reservation_id,

          provider,
          provider_reservation_id,
          provider_calendar_id,
          provider_edit_id,

          revision,
          lifecycle,
          payload

        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(

        record.tenantId,

        record.canonicalReservationId,

        record.provider,

        record.providerReservationId,

        record.providerCalendarId ??
          null,

        record.providerEditId ??
          null,

        record.revision,

        record.lifecycle,

        record.payload,

      )
      .run();

  }


  // ============================================================
  // Update canonical reservation record
  // ============================================================

  async update(
    record: ReservationRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE reservation_records
        SET

          provider = ?,
          provider_reservation_id = ?,
          provider_calendar_id = ?,
          provider_edit_id = ?,

          revision = ?,
          lifecycle = ?,
          payload = ?,

          updated_at = CURRENT_TIMESTAMP

        WHERE
          tenant_id = ?
          AND canonical_reservation_id = ?
        `,
      )
      .bind(

        record.provider,

        record.providerReservationId,

        record.providerCalendarId ??
          null,

        record.providerEditId ??
          null,

        record.revision,

        record.lifecycle,

        record.payload,

        record.tenantId,

        record.canonicalReservationId,

      )
      .run();

  }


    // ============================================================
  // Create or update canonical reservation state
  // ============================================================

  async upsert(
    record: ReservationRecord,
  ): Promise<void> {

    await this.db
      .prepare(
        `
        INSERT INTO reservation_records (

          tenant_id,
          canonical_reservation_id,

          provider,
          provider_reservation_id,
          provider_calendar_id,
          provider_edit_id,

          revision,
          lifecycle,
          payload

        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

        ON CONFLICT (
          tenant_id,
          canonical_reservation_id
        )
        DO UPDATE SET

          provider =
            excluded.provider,

          provider_reservation_id =
            excluded.provider_reservation_id,

          provider_calendar_id =
            excluded.provider_calendar_id,

          provider_edit_id =
            excluded.provider_edit_id,

          revision =
            excluded.revision,

          lifecycle =
            excluded.lifecycle,

          payload =
            excluded.payload,

          updated_at =
            CURRENT_TIMESTAMP
        `,
      )
      .bind(

        record.tenantId,

        record.canonicalReservationId,

        record.provider,

        record.providerReservationId,

        record.providerCalendarId ??
          null,

        record.providerEditId ??
          null,

        record.revision,

        record.lifecycle,

        record.payload,

      )
      .run();

  }

}


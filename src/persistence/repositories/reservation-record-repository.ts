import { BaseRepository } from "./base-repository";

import type {
  ReservationRecord,
} from "../models/reservation-record";


export class ReservationRecordRepository
  extends BaseRepository {

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


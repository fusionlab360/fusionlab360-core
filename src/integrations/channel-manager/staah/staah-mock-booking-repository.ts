import {
  STAAHMockBookingError,
  type STAAHMockBookingResult,
} from "./staah-mock-booking-contracts";

export interface STAAHStoredMockBooking {
  requestHash: string;
  result: STAAHMockBookingResult;
}

interface StoredRow {
  request_hash: string;
  result_json: string;
  provider_property_id: string;
}

export class STAAHMockBookingRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Retrieve a previously submitted synthetic booking.
   * Caller must verify tenant ownership before using this.
   */
  async find(
    tenantId: string,
    integrationId: string,
    idempotencyKey: string,
  ): Promise<STAAHStoredMockBooking | null> {
    const row = await this.db.prepare(`
      SELECT
        request_hash,
        result_json,
        provider_property_id
      FROM staah_mock_booking_submissions
      WHERE tenant_id = ?
        AND integration_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `).bind(
      tenantId,
      integrationId,
      idempotencyKey,
    ).first<StoredRow>();

    if (!row) return null;

    let result: STAAHMockBookingResult;

    try {
      result = JSON.parse(
        row.result_json,
      ) as STAAHMockBookingResult;
    } catch {
      throw new STAAHMockBookingError(
        503,
        "mock_booking_unavailable",
      );
    }

    if (
      !result ||
      result.mode !== "mock" ||
      result.provider !== "staah" ||
      result.status !== "simulated" ||
      !result.bookingReference ||
      result.providerPropertyId !==
        row.provider_property_id
    ) {
      throw new STAAHMockBookingError(
        503,
        "mock_booking_unavailable",
      );
    }

    return {
      requestHash: row.request_hash,
      result,
    };
  }

  /**
   * Atomic idempotent persistence.
   *
   * The first successful insert wins.
   * Concurrent identical submissions return the same
   * stored result. Different requests sharing a key fail.
   */
  async saveOrReplay(
    tenantId: string,
    integrationId: string,
    idempotencyKey: string,
    providerPropertyId: string,
    requestHash: string,
    result: STAAHMockBookingResult,
  ): Promise<{
    result: STAAHMockBookingResult;
    replayed: boolean;
  }> {
    if (
      !/^[a-f0-9]{64}$/.test(requestHash) ||
      result.mode !== "mock" ||
      result.provider !== "staah" ||
      result.status !== "simulated" ||
      result.providerPropertyId !== providerPropertyId
    ) {
      throw new STAAHMockBookingError(
        503,
        "mock_booking_unavailable",
      );
    }

    const inserted = await this.db.prepare(`
      INSERT INTO staah_mock_booking_submissions (
        tenant_id,
        integration_id,
        idempotency_key,
        provider_property_id,
        request_hash,
        result_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (
        tenant_id,
        integration_id,
        idempotency_key
      ) DO NOTHING
    `).bind(
      tenantId,
      integrationId,
      idempotencyKey,
      providerPropertyId,
      requestHash,
      JSON.stringify(result),
    ).run();

    if (inserted.meta.changes === 1) {
      return {
        result,
        replayed: false,
      };
    }

    const existing = await this.find(
      tenantId,
      integrationId,
      idempotencyKey,
    );

    if (!existing) {
      throw new STAAHMockBookingError(
        503,
        "mock_booking_unavailable",
      );
    }

    if (existing.requestHash !== requestHash) {
      throw new STAAHMockBookingError(
        409,
        "idempotency_conflict",
      );
    }

    return {
      result: existing.result,
      replayed: true,
    };
  }
}
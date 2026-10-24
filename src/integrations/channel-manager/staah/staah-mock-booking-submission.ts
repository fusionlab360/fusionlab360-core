import {
  STAAHConnectionManagementService,
} from "./staah-management";

import {
  STAAHMockBookingService,
} from "./staah-mock-booking";

import {
  STAAHMockBookingRepository,
} from "./staah-mock-booking-repository";

import {
  STAAHMockBookingError,
  validateSTAAHMockBookingRequest,
  type STAAHMockBookingResult,
} from "./staah-mock-booking-contracts";

export interface STAAHMockSubmissionOutcome {
  result: STAAHMockBookingResult;
  replayed: boolean;
}

async function hashRequest(
  tenantId: string,
  integrationId: string,
  providerPropertyId: string,
  request: ReturnType<
    typeof validateSTAAHMockBookingRequest
  >,
): Promise<string> {
  const canonical = JSON.stringify({
    tenantId,
    integrationId,
    providerPropertyId,
    request,
  });

  const bytes = new TextEncoder().encode(canonical);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes,
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) =>
      byte.toString(16).padStart(2, "0"),
    )
    .join("");
}

/**
 * M6.3C — Durable synthetic STAAH booking submission.
 *
 * The repository MUST use a separate disposable mock D1.
 *
 * This service does not:
 * - create canonical reservations
 * - mutate room inventory
 * - dispatch integration events
 * - contact STAAH
 * - synchronize with GHL
 */
export class STAAHMockBookingSubmissionService {
  private readonly quotes: STAAHMockBookingService;

  constructor(
    private readonly management:
      STAAHConnectionManagementService,
    private readonly repository:
      STAAHMockBookingRepository,
  ) {
    this.quotes = new STAAHMockBookingService(
      management,
    );
  }

  async submit(
    tenantId: string,
    integrationId: string,
    input: unknown,
  ): Promise<STAAHMockSubmissionOutcome> {
    const request =
      validateSTAAHMockBookingRequest(input);

    // Ownership, enabled status and verification
    // are enforced by the main Core connection.
    const connection =
      await this.management.loadOperationalConnection(
        tenantId,
        integrationId,
      );

    const requestHash = await hashRequest(
      tenantId,
      integrationId,
      connection.syntheticPropertyId,
      request,
    );

    // Replay first, without recalculating availability.
    const existing = await this.repository.find(
      tenantId,
      integrationId,
      request.idempotencyKey,
    );

    if (existing) {
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

    // A new submission must pass all synthetic
    // room, rate, occupancy and availability checks.
    const quote = await this.quotes.quote(
      tenantId,
      integrationId,
      request,
    );

    const result: STAAHMockBookingResult = {
      mode: "mock",
      provider: "staah",
      status: "simulated",
      bookingReference:
        `mock-booking-${crypto.randomUUID()}`,
      providerPropertyId:
        quote.providerPropertyId,
      providerRoomId:
        quote.providerRoomId,
      providerRatePlanId:
        quote.providerRatePlanId,
      checkIn:
        quote.checkIn,
      checkOut:
        quote.checkOut,
      quantity:
        quote.quantity,
      adults:
        quote.adults,
      currency:
        quote.currency,
      totalAmountMinor:
        quote.totalAmountMinor,
    };

    // The database's unique key resolves concurrent
    // submissions using the same idempotency key.
    return this.repository.saveOrReplay(
      tenantId,
      integrationId,
      request.idempotencyKey,
      connection.syntheticPropertyId,
      requestHash,
      result,
    );
  }
}
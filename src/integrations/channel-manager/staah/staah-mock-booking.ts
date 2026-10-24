import { resolveSTAAHAdapter } from "./";

import { STAAHConnectionManagementService } from "./staah-management";
import { STAAHMockARIService } from "./staah-ari";

import {
  STAAHMockBookingError,
  validateSTAAHMockBookingRequest,
  type STAAHMockBookingQuote,
} from "./staah-mock-booking-contracts";

const DAY_MS = 86_400_000;

/**
 * M6.3B — Read-only synthetic booking validation.
 *
 * No booking creation.
 * No inventory mutation.
 * No canonical reservation persistence.
 * No GHL synchronization.
 * No live STAAH API calls.
 */
export class STAAHMockBookingService {
  private readonly ari: STAAHMockARIService;

  constructor(
    private readonly management: STAAHConnectionManagementService,
  ) {
    this.ari = new STAAHMockARIService(management);
  }

  async quote(
    tenantId: string,
    integrationId: string,
    input: unknown,
  ): Promise<STAAHMockBookingQuote> {
    // Validate untrusted booking input.
    const booking =
      validateSTAAHMockBookingRequest(input);

    // Existing management service enforces tenant ownership,
    // enabled status and mock verification.
    const connection =
      await this.management.loadOperationalConnection(
        tenantId,
        integrationId,
      );

    const adapter = resolveSTAAHAdapter(
      connection.context,
      {
        mode: "mock",
        profile: "crm",
        mockFailureScenario: connection.mockFailureScenario,
      },
    );

    const property = await adapter.getProperty(
      connection.context,
      connection.syntheticPropertyId,
    );

    const room = property.rooms.find(
      (item) =>
        item.providerRoomId === booking.providerRoomId,
    );

    const ratePlan = property.ratePlans.find(
      (item) =>
        item.providerRatePlanId === booking.providerRatePlanId,
    );

    if (!room || !ratePlan) {
      throw new STAAHMockBookingError(
        400,
        "invalid_booking_request",
      );
    }

    // Prevent an impossible occupancy request.
    if (booking.adults > room.capacity * booking.quantity) {
      throw new STAAHMockBookingError(
        400,
        "invalid_booking_request",
      );
    }

    const checkInTime = Date.parse(
      `${booking.checkIn}T00:00:00.000Z`,
    );

    const checkOutTime = Date.parse(
      `${booking.checkOut}T00:00:00.000Z`,
    );

    const nights =
      (checkOutTime - checkInTime) / DAY_MS;

    // Checkout day is excluded from occupied nights.
    const lastOccupiedDate = new Date(
      checkOutTime - DAY_MS,
    )
      .toISOString()
      .slice(0, 10);

    const ari = await this.ari.retrieve(
      tenantId,
      integrationId,
      {
        startDate: booking.checkIn,
        endDate: lastOccupiedDate,
      },
    );

    let totalAmountMinor = 0;

    for (let night = 0; night < nights; night++) {
      const date = new Date(
        checkInTime + night * DAY_MS,
      )
        .toISOString()
        .slice(0, 10);

      const matchingRecords = ari.records.filter(
        (record) =>
          record.date === date &&
          record.providerRoomId === booking.providerRoomId &&
          record.providerRatePlanId ===
            booking.providerRatePlanId,
      );

      // Every requested night must have exactly one
      // matching synthetic ARI record.
      if (matchingRecords.length !== 1) {
        throw new STAAHMockBookingError(
          503,
          "mock_booking_unavailable",
        );
      }

      const record = matchingRecords[0]!;

      if (record.currency !== ratePlan.currency) {
        throw new STAAHMockBookingError(
          503,
          "mock_booking_unavailable",
        );
      }

      if (
        !record.sellable ||
        record.availableRooms < booking.quantity
      ) {
        throw new STAAHMockBookingError(
          409,
          "inventory_unavailable",
        );
      }

      const nightlyTotal =
        record.rateAmountMinor * booking.quantity;

      if (
        !Number.isSafeInteger(nightlyTotal) ||
        !Number.isSafeInteger(
          totalAmountMinor + nightlyTotal,
        )
      ) {
        throw new STAAHMockBookingError(
          503,
          "mock_booking_unavailable",
        );
      }

      totalAmountMinor += nightlyTotal;
    }

    return {
      mode: "mock",
      provider: "staah",
      providerPropertyId: connection.syntheticPropertyId,
      providerRoomId: booking.providerRoomId,
      providerRatePlanId: booking.providerRatePlanId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights,
      quantity: booking.quantity,
      adults: booking.adults,
      currency: ratePlan.currency,
      totalAmountMinor,
      inventoryAvailable: true,
    };
  }
}
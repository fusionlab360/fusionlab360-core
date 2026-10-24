/**
 * Internal synthetic STAAH booking contracts.
 *
 * These are NOT official STAAH booking API payloads.
 * No live booking or downstream GHL synchronization.
 */

export interface STAAHMockBookingRequest {
  idempotencyKey: string;
  providerRoomId: string;
  providerRatePlanId: string;
  checkIn: string;
  checkOut: string;
  quantity: number;
  adults: number;
  guest: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface STAAHMockBookingResult {
  mode: "mock";
  provider: "staah";
  status: "simulated";
  bookingReference: string;
  providerPropertyId: string;
  providerRoomId: string;
  providerRatePlanId: string;
  checkIn: string;
  checkOut: string;
  quantity: number;
  adults: number;
  currency: string;
  totalAmountMinor: number;
}

export class STAAHMockBookingError extends Error {
  constructor(
    readonly status: 400 | 409 | 503,
    readonly code:
      | "invalid_booking_request"
      | "inventory_unavailable"
      | "idempotency_conflict"
      | "mock_booking_unavailable",
  ) {
    super("Synthetic STAAH booking request could not be processed.");
    this.name = "STAAHMockBookingError";
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function invalidRequest(): never {
  throw new STAAHMockBookingError(
    400,
    "invalid_booking_request",
  );
}

/**
 * Validates and normalizes untrusted booking input.
 *
 * Maximum stay is 30 nights, matching the 31-day
 * inclusive range supported by mock ARI.
 */
export function validateSTAAHMockBookingRequest(
  input: unknown,
): STAAHMockBookingRequest {
  if (!isRecord(input) || !isRecord(input.guest)) {
    return invalidRequest();
  }

  const {
    idempotencyKey,
    providerRoomId,
    providerRatePlanId,
    checkIn,
    checkOut,
    quantity,
    adults,
    guest,
  } = input;

  if (
    typeof idempotencyKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(
      idempotencyKey,
    ) ||
    typeof providerRoomId !== "string" ||
    typeof providerRatePlanId !== "string" ||
    !/^mock-[A-Za-z0-9._-]{1,63}$/.test(providerRoomId) ||
    !/^mock-[A-Za-z0-9._-]{1,63}$/.test(providerRatePlanId) ||
    !validDate(checkIn) ||
    !validDate(checkOut) ||
    !Number.isSafeInteger(quantity) ||
    (quantity as number) < 1 ||
    (quantity as number) > 8 ||
    !Number.isSafeInteger(adults) ||
    (adults as number) < 1 ||
    (adults as number) > 32
  ) {
    return invalidRequest();
  }

  const nights =
    (
      Date.parse(`${checkOut}T00:00:00.000Z`) -
      Date.parse(`${checkIn}T00:00:00.000Z`)
    ) / 86_400_000;

  if (
    !Number.isInteger(nights) ||
    nights < 1 ||
    nights > 30
  ) {
    return invalidRequest();
  }

  const { firstName, lastName, email } = guest;

  if (
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof email !== "string"
  ) {
    return invalidRequest();
  }

  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const normalizedEmail = email.trim();

  if (
    normalizedFirstName.length < 1 ||
    normalizedFirstName.length > 100 ||
    normalizedLastName.length < 1 ||
    normalizedLastName.length > 100 ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    return invalidRequest();
  }

  return {
    idempotencyKey,
    providerRoomId,
    providerRatePlanId,
    checkIn,
    checkOut,
    quantity: quantity as number,
    adults: adults as number,
    guest: {
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      email: normalizedEmail,
    },
  };
}

/**
 * Read-only synthetic booking quote.
 * This is not a confirmed or reserved booking.
 */
export interface STAAHMockBookingQuote {
  mode: "mock";
  provider: "staah";
  providerPropertyId: string;
  providerRoomId: string;
  providerRatePlanId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  quantity: number;
  adults: number;
  currency: string;
  totalAmountMinor: number;
  inventoryAvailable: true;
}
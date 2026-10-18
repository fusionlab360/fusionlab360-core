import type { ReservationPayload } from "./types";
import { ApiError } from "../../core/errors/ApiError";

export function validateReservation(
  input: unknown,
): ReservationPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Invalid reservation payload.");
  }

  const source = input as Record<string, unknown>;
  if (
    typeof source.reservationId !== "string" ||
    !source.reservationId.trim()
  ) {
    throw new ApiError(400, "Reservation ID is required.");
  }

  if (
    typeof source.firstName !== "string" ||
    !source.firstName.trim()
  ) {
    throw new ApiError(400, "First Name is required.");
  }

  const reservation: ReservationPayload = {
    reservationId: source.reservationId.trim(),
    firstName: source.firstName.trim(),
  };

  const stringFields = [
    "provider", "otaReferenceNumber", "status", "bookingDate", "createdAt",
    "modifiedAt", "checkIn", "checkOut", "remarks", "specialRequests",
    "lastName", "fullName", "email", "phone", "passport", "identityNumber",
    "identityType", "nationality", "address", "city", "state", "country",
    "postalCode", "roomType", "roomNumber", "ratePlan", "package", "currency",
    "paymentMethod", "paymentStatus", "channelSource", "ota", "travelAgent",
    "marketSegment", "hotelId", "hotelName", "branchId", "branchName",
    "timezone", "hotelCountry", "extractedAt",
  ] as const satisfies readonly (keyof ReservationPayload)[];

  for (const field of stringFields) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new ApiError(400, "Invalid reservation payload.");
    }
    reservation[field] = value;
  }

  const numberFields = [
    "nights", "adults", "children", "infants", "totalAmount", "paidAmount", "balance",
  ] as const satisfies readonly (keyof ReservationPayload)[];

  for (const field of numberFields) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ApiError(400, "Invalid reservation payload.");
    }
    reservation[field] = value;
  }

  return reservation;

}

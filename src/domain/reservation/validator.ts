import type { ReservationPayload } from "./types";

export function validateReservation(
  payload: ReservationPayload
): ReservationPayload {

  if (!payload.reservationId?.trim()) {
    throw new Error("Reservation ID is required.");
  }

  if (!payload.firstName?.trim()) {
    throw new Error("First Name is required.");
  }

  return payload;
}
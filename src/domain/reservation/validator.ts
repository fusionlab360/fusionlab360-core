import type { ReservationPayload } from "./types";

export function validateReservation(
  payload: ReservationPayload
): ReservationPayload {

  if (!payload.firstName?.trim()) {
    throw new Error("First Name is required.");
  }

  if (!payload.email && !payload.phone) {
    throw new Error("Email or Phone is required.");
  }

  return payload;
}
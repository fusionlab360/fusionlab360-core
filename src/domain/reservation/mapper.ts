import type { ReservationPayload } from "./types";

export function mapReservationToContact(
  reservation: ReservationPayload,
) {
  return {
    firstName: reservation.firstName,
    lastName: reservation.lastName,

    email: reservation.email,
    phone: reservation.phone,

    nationality: reservation.nationality,

    identityNumber: reservation.identityNumber,
    identityType: reservation.identityType,
  };
}
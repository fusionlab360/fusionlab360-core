import type { ReservationPayload } from "./types";

export function mapReservationToContact(
  reservation: ReservationPayload,
) {

  return {

    // ----------------------------------------
    // Guest
    // ----------------------------------------

    firstName:
      reservation.firstName,

    lastName:
      reservation.lastName,

    email:
      reservation.email,

    phone:
      reservation.phone,

    passport:
      reservation.passport,

    identityNumber:
      reservation.identityNumber,

    identityType:
      reservation.identityType,

    nationality:
      reservation.nationality,

    // ----------------------------------------
    // Address
    // ----------------------------------------

    address:
      reservation.address,

    city:
      reservation.city,

    state:
      reservation.state,

    country:
      reservation.country,

    postalCode:
      reservation.postalCode,

  };

}

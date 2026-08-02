import type { ReservationPayload } from "./types";

export function mapReservationToContact(
  reservation: ReservationPayload,
) {

  console.log("===== CONTACT MAPPER =====");
  console.log(
    JSON.stringify(
      {
        firstName: reservation.firstName,
        passport: reservation.passport,
        identityNumber: reservation.identityNumber,
        nationality: reservation.nationality,
        address: reservation.address,
        city: reservation.city,
        state: reservation.state,
        country: reservation.country,
        postalCode: reservation.postalCode,
      },
      null,
      2,
    ),
  );

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
export const CanonicalReservationEventType = {

  CREATED:
    "reservation.created",

  UPDATED:
    "reservation.updated",

  CHECKED_IN:
    "reservation.checked_in",

  CHECKED_OUT:
    "reservation.checked_out",

  CANCELLED:
    "reservation.cancelled",

} as const;


export type CanonicalReservationEventType =
  typeof CanonicalReservationEventType[
    keyof typeof CanonicalReservationEventType
  ];
export type ReservationRevision =
  number;


export const INITIAL_RESERVATION_REVISION:
  ReservationRevision = 0;


export function nextReservationRevision(
  current:
    ReservationRevision,
): ReservationRevision {

  return current + 1;

}
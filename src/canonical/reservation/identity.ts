export type CanonicalReservationId =
  string;


export function createCanonicalReservationId(): CanonicalReservationId {

  return crypto.randomUUID();

}
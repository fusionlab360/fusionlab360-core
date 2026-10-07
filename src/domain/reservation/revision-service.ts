import type {
  ReservationLink,
} from "../../persistence/models/reservation-link";


export type ReservationRevisionDecision =
  | "accept"
  | "stale"
  | "same";


export interface ReservationRevisionResult {

  decision:
    ReservationRevisionDecision;

  storedRevision:
    number;

  incomingRevision:
    number;

}


export function evaluateReservationRevision(
  stored:
    ReservationLink,
  incomingRevision:
    number,
): ReservationRevisionResult {

  const storedRevision =
    stored.revision ??
    0;


  if (
    incomingRevision <
    storedRevision
  ) {

    return {

      decision:
        "stale",

      storedRevision,

      incomingRevision,

    };

  }


  if (
    incomingRevision ===
    storedRevision
  ) {

    return {

      decision:
        "same",

      storedRevision,

      incomingRevision,

    };

  }


  return {

    decision:
      "accept",

    storedRevision,

    incomingRevision,

  };

}
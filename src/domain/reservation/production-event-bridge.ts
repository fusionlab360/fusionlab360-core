import type {
  ReservationPayload,
} from "./types";

import type {
  PMSEvent,
} from "../../core/pms/models/reservation-event";

import type {
  ReservationLifecycle,
} from "./lifecycle";


function resolveLifecycle(
  status?: string,
):
  ReservationLifecycle {

  const normalized =
    String(
      status ?? "",
    )
      .trim()
      .toUpperCase();

  switch (normalized) {

    case "CONFIRMED":
    case "OPEN":
    case "R":
      return "confirmed";

    case "ARRIVING":
    case "ARRIVAL_TODAY":
      return "arrival_today";

    case "CHECKED_IN":
    case "CHECK IN":
    case "CHECK-IN":
    case "C":
      return "checked_in";

    case "CHECKED_OUT":
    case "CHECK OUT":
    case "CHECK-OUT":    
    case "D":
      return "checked_out";

    case "CANCELLED":
      return "cancelled";

    case "NO_SHOW":
      return "no_show";

    case "COMPLETED":
      return "completed";

    default:
      return "new_booking";

  }

}


export function buildProductionReservationEvent(
  payload:
    ReservationPayload,
):
  PMSEvent {

  const lifecycle =
    resolveLifecycle(
      payload.status,
    );


  const eventType =
    lifecycle === "checked_in"

      ? "reservation.checked_in"

      : lifecycle === "checked_out"

        ? "reservation.checked_out"

        : "reservation.updated";


  const provider =
    payload.provider ??
    "unknown";


  return {

    eventType,

    provider,

    providerIdentity: {

      provider,

      providerReservationId:
        payload.reservationId,

      // The legacy /reservations/sync payload does not
      // currently expose PMS calendar identity.
      //
      // These remain undefined until the upstream PMS
      // event carries them.

      providerCalendarId:
        undefined,

      providerEditId:
        undefined,

    },

    reservation:
      payload,

    lifecycle,

    occurredAt:
      new Date().toISOString(),

    // Do NOT manufacture a revision here.
    //
    // The current production ReservationPayload does
    // not carry a trustworthy provider revision.

    revision:
      undefined,

  };

}
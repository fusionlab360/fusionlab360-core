import type { ReservationOpportunity } from "./opportunity";

export type ReservationLifecycle =
  | "new_booking"
  | "confirmed"
  | "arrival_today"
  | "checked_in"
  | "checked_out"
  | "completed"
  | "cancelled"
  | "no_show";

export function resolveReservationLifecycle(
  reservation: ReservationOpportunity,
): ReservationLifecycle {

  switch (reservation.status) {

    case "CONFIRMED":
      return "confirmed";

    case "ARRIVING":
      return "arrival_today";

    case "CHECKED_IN":
      return "checked_in";

    case "CHECKED_OUT":
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
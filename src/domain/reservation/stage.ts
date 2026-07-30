import type { ReservationOpportunity } from "./opportunity";

export function resolveReservationStage(
  opportunity: ReservationOpportunity
): string {
  switch (opportunity.status) {
    case "CANCELLED":
      return "cancelled";

    case "NO_SHOW":
      return "no_show";

    case "CHECKED_OUT":
      return "checked_out";

    case "CHECKED_IN":
      return "checked_in";

    case "ARRIVING":
      return "arriving_today";

    case "CONFIRMED":
      return "confirmed";

    default:
      return "new_reservation";
  }
}
import type { ReservationOpportunity } from "./opportunity";

export function resolveReservationStage(
  opportunity: ReservationOpportunity
): string {
  switch (opportunity.status) {
    case "CANCELLED":
      return "Cancelled";

    case "NO_SHOW":
      return "No Show";

    case "CHECKED_OUT":
      return "Checked Out";

    case "CHECKED_IN":
      return "Checked In";

    case "ARRIVING":
      return "Arriving Today";

    case "CONFIRMED":
      return "Confirmed";

    default:
      return "New Reservation";
  }
}
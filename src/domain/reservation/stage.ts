import type {
  ReservationLifecycle,
} from "./lifecycle";


export function resolveReservationStage(
  lifecycle:
    ReservationLifecycle,
): string {

  switch (lifecycle) {

    case "new_booking":
      return "new_booking";

    case "confirmed":
      return "new_booking";

    case "arrival_today":
      return "today_arrival";

    case "checked_in":
      return "checked_in";

    case "checked_out":
      return "checked_out";

    case "completed":
      return "checked_out";

    case "cancelled":
      return "cancelled";

    case "no_show":
      return "no_show";

    default:
      throw new Error(
        `Unsupported reservation lifecycle: ${lifecycle}`,
      );

  }

}
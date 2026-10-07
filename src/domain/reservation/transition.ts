import type { ReservationLifecycle } from "./lifecycle";

export function shouldMoveOpportunity(
  current: ReservationLifecycle,
  incoming: ReservationLifecycle,
): boolean {

  if (current === incoming) {
    return false;
  }

  const order: ReservationLifecycle[] = [
    "new_booking",
    "confirmed",
    "arrival_today",
    "checked_in",
    "checked_out",
    "completed",
  ];

  const currentIndex =
    order.indexOf(current);

  const incomingIndex =
    order.indexOf(incoming);

  if (
    currentIndex >= 0 &&
    incomingIndex >= 0
  ) {
    return incomingIndex > currentIndex;
  }

  // Always allow terminal states
  if (
    incoming === "cancelled" ||
    incoming === "no_show"
  ) {
    return true;
  }

  return false;
}
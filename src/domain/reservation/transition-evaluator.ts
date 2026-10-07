import type {
  ReservationLifecycle,
} from "./lifecycle";


export type ReservationTransition =
  | "none"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show"
  | "completed";


export type ReservationTransitionValidity =
  | "valid"
  | "invalid";


export interface ReservationTransitionResult {

  changed: boolean;

  transition:
    ReservationTransition;

  validity:
    ReservationTransitionValidity;

  previous:
    ReservationLifecycle;

  current:
    ReservationLifecycle;

  reason?: string;

}


/**
 * Determines whether a lifecycle transition is valid.
 *
 * This is Core lifecycle logic only.
 *
 * It does NOT:
 * - move a CRM opportunity
 * - call GHL
 * - inspect ABS
 * - inspect a room
 * - infer checkout from a missing reservation
 */
export function isValidReservationTransition(
  previous:
    ReservationLifecycle,
  current:
    ReservationLifecycle,
): boolean {

  // ------------------------------------------------------------
  // No state change
  // ------------------------------------------------------------

  if (
    previous ===
    current
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Normal booking progression
  // ------------------------------------------------------------

  if (
    previous ===
      "new_booking" &&
    (
      current ===
        "confirmed" ||
      current ===
        "arrival_today"
    )
  ) {

    return true;

  }


  if (
    previous ===
      "confirmed" &&
    (
      current ===
        "arrival_today" ||
      current ===
        "checked_in" ||
      current ===
        "checked_out"
    )
  ) {

    return true;

  }


  if (
    previous ===
      "arrival_today" &&
    (
      current ===
        "checked_in" ||
      current ===
        "checked_out"
    )
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Check-in
  // ------------------------------------------------------------

  if (
    current ===
      "checked_in" &&
    (
      previous ===
        "new_booking" ||
      previous ===
        "confirmed" ||
      previous ===
        "arrival_today"
    )
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Checkout
  //
  // Same-day stays are allowed:
  //
  // confirmed → checked_out
  // arrival_today → checked_out
  // checked_in → checked_out
  // ------------------------------------------------------------

  if (
    current ===
      "checked_out" &&
    (
      previous ===
        "confirmed" ||
      previous ===
        "arrival_today" ||
      previous ===
        "checked_in"
    )
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Completed
  //
  // Completion follows checkout.
  // ------------------------------------------------------------

  if (
    previous ===
      "checked_out" &&
    current ===
      "completed"
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Cancellation
  //
  // Cancellation is allowed before occupancy.
  // ------------------------------------------------------------

  if (
    current ===
      "cancelled" &&
    (
      previous ===
        "new_booking" ||
      previous ===
        "confirmed" ||
      previous ===
        "arrival_today"
    )
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // No-show
  //
  // A no-show belongs to the arrival stage.
  // ------------------------------------------------------------

  if (
    current ===
      "no_show" &&
    (
      previous ===
        "confirmed" ||
      previous ===
        "arrival_today"
    )
  ) {

    return true;

  }


  // ------------------------------------------------------------
  // Terminal states cannot move backward.
  // ------------------------------------------------------------

  return false;

}


/**
 * Evaluates a lifecycle transition and reports
 * whether it is valid.
 */
export function evaluateReservationTransition(
  previous:
    ReservationLifecycle,
  current:
    ReservationLifecycle,
): ReservationTransitionResult {

  // ------------------------------------------------------------
  // No change
  // ------------------------------------------------------------

  if (
    previous ===
    current
  ) {

    return {

      changed:
        false,

      transition:
        "none",

      validity:
        "valid",

      previous,

      current,

    };

  }


  const valid =
    isValidReservationTransition(
      previous,
      current,
    );


  // ------------------------------------------------------------
  // Invalid transition
  // ------------------------------------------------------------

  if (!valid) {

    return {

      changed:
        true,

      transition:
        "none",

      validity:
        "invalid",

      previous,

      current,

      reason:
        `Invalid reservation lifecycle transition: ${previous} → ${current}`,

    };

  }


  // ------------------------------------------------------------
  // Operational transitions
  // ------------------------------------------------------------

  if (
    current ===
      "checked_in"
  ) {

    return {

      changed:
        true,

      transition:
        "checked_in",

      validity:
        "valid",

      previous,

      current,

    };

  }


  if (
    current ===
      "checked_out"
  ) {

    return {

      changed:
        true,

      transition:
        "checked_out",

      validity:
        "valid",

      previous,

      current,

    };

  }


  if (
    current ===
      "cancelled"
  ) {

    return {

      changed:
        true,

      transition:
        "cancelled",

      validity:
        "valid",

      previous,

      current,

    };

  }


  if (
    current ===
      "no_show"
  ) {

    return {

      changed:
        true,

      transition:
        "no_show",

      validity:
        "valid",

      previous,

      current,

    };

  }


  if (
    current ===
      "completed"
  ) {

    return {

      changed:
        true,

      transition:
        "completed",

      validity:
        "valid",

      previous,

      current,

    };

  }


  // ------------------------------------------------------------
  // Non-operational lifecycle progression
  // ------------------------------------------------------------

  return {

    changed:
      true,

    transition:
      "none",

    validity:
      "valid",

    previous,

    current,

  };

}
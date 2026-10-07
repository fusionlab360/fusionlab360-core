import type {
  ReservationCrmState,
} from "./crm-state";

import type {
  ReservationCrmDecision,
} from "./crm-decision";

import type {
  ReservationLink,
} from "../../persistence/models/reservation-link";

import type {
  ContactIdentityResolution,
} from "../contact/reconcile";

export function decideReservationCrmAction(
  reservationLink:
    ReservationLink | null,

  currentCrmState:
    ReservationCrmState | null,

  contactResolution?:
    ContactIdentityResolution,
): ReservationCrmDecision {

      const contactAction =
    contactResolution?.match ===
    "provider_contact"
      ? "update"
      : contactResolution?.match ===
          "none"
        ? "create"
        : "none";

  const canonicalContactId =
    contactResolution?.canonicalContactId;

  // ------------------------------------------------------------
  // No existing CRM state
  //
  // This is a Core-side creation decision.
  // ------------------------------------------------------------

  if (!reservationLink) {
  return {
    action: "create_contact",

    contactAction:
      "create",

    canonicalContactId,

    currentState:
      currentCrmState ??
      undefined,

    reason:
      "No existing reservation CRM link is known by Core.",
  };
}

  // ------------------------------------------------------------
  // Existing contact, but no opportunity
  // ------------------------------------------------------------

  if (
  reservationLink.contactId &&
  !reservationLink.opportunityId
) {
  return {
    action:
      "create_opportunity",

    contactAction,

    canonicalContactId,

    currentState:
      currentCrmState ??
      undefined,

    reason:
      "Reservation has a known contact but no linked opportunity.",
  };
}


  // ------------------------------------------------------------
  // Existing reservation with CRM linkage
  //
  // Core already knows the relationship.
  // Do not create a new opportunity simply because guest
  // information changed.
  // ------------------------------------------------------------

  if (
  reservationLink.opportunityId
) {
  return {
    action:
      "update_opportunity",

    contactAction,

    canonicalContactId,

    currentState:
      currentCrmState ??
      undefined,

    reason:
      "Reservation already has a linked CRM opportunity.",
  };
}


  return {
  action:
    "none",

  contactAction,

  canonicalContactId,

  currentState:
    currentCrmState ??
    undefined,

  reason:
    "No CRM action is required.",
};

}
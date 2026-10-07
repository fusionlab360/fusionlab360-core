import type {
  ReservationCrmState,
} from "./crm-state";

export type ReservationCrmAction =
  | "create_contact"
  | "update_contact"
  | "create_opportunity"
  | "update_opportunity"
  | "move_opportunity"
  | "none";

export type ReservationContactAction =
  | "create"
  | "update"
  | "none";

export interface ReservationCrmDecision {

  action:
    ReservationCrmAction;

  contactAction?:
    ReservationContactAction;

  canonicalContactId?:
    string;

  currentState?:
    ReservationCrmState;

  reason:
    string;
}
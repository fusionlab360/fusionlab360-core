import type {
  ReservationPayload,
} from "../../../domain/reservation/types";

import type {
  ReservationLifecycle,
} from "../../../domain/reservation/lifecycle";

import type {
  ReservationProviderIdentity,
} from "../../../canonical/reservation";


export type PMSEventType =
  | "reservation.created"
  | "reservation.updated"
  | "reservation.checked_in"
  | "reservation.checked_out"
  | "reservation.cancelled";


export interface PMSEvent {

  eventType:
    PMSEventType;

  provider:
    string;

  providerIdentity:
    ReservationProviderIdentity;

  reservation:
    ReservationPayload;

  lifecycle?:
    ReservationLifecycle;

  occurredAt:
    string;

  revision?: 
    number;

}
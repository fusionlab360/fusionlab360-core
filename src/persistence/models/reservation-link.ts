import type {
  ReservationLifecycle,
} from "../../domain/reservation/lifecycle";


export interface ReservationLink {

  tenantId:
    string;

  reservationId:
    string;

  canonicalReservationId?:
    string;

  provider?:
    string;

  providerReservationId?:
    string;

  providerCalendarId?:
    string;

  providerEditId?:
    string;

  revision?:
    number;

  lastEventId?:
    string;

  contactId?:
    string | null;

  opportunityId?:
    string | null;

  lifecycle:
    ReservationLifecycle;

  createdAt:
    Date;

  updatedAt:
    Date;

}
import type {
  ReservationLifecycle,
} from "./lifecycle";

import type {
  CanonicalContactIdentity,
} from "../contact/identity";

import type {
  CanonicalOpportunityIdentity,
} from "./opportunity-identity";


export interface ReservationCrmState {

  contactId?: string;

  opportunityId?: string;

  contactIdentity?:
    CanonicalContactIdentity;

  opportunityIdentity?:
    CanonicalOpportunityIdentity;

  lifecycle:
    ReservationLifecycle;

}
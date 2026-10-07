import type {
  ReservationField,
} from "../../canonical/reservation";

import type {
  CanonicalReservationEventPayload,
} from "./canonical-event-payload";


export interface ReservationUpdateEventPayload
  extends CanonicalReservationEventPayload {

  changedFields:
    ReservationField[];

}
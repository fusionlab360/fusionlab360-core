import type {
  ReservationLifecycle,
} from "./lifecycle";

import type {
  CanonicalReservationEventPayload,
} from "./canonical-event-payload";


export interface ReservationLifecycleEventPayload
  extends CanonicalReservationEventPayload {

  lifecycle:
    ReservationLifecycle;

}
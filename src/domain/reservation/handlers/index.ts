import type {
  ReservationEvent,
} from "../events";

export interface ReservationEventHandler {

  handle(
    event: ReservationEvent,
  ): Promise<void>;

}
import type {
  ReservationEvent,
} from "./events";

import {
  LoggerReservationHandler,
} from "./handlers/logger-handler";

import type {
  ReservationEventHandler,
} from "./handlers";

const handlers: ReservationEventHandler[] = [

  new LoggerReservationHandler(),

];

export async function dispatchReservationEvent(
  event: ReservationEvent,
): Promise<void> {

  for (const handler of handlers) {

    await handler.handle(
      event,
    );

  }

}
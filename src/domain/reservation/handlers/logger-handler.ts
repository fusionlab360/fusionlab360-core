import { logger } from "../../../core/logger";

import type {
  ReservationEvent,
} from "../events";

import type {
  ReservationEventHandler,
} from "./index";

export class LoggerReservationHandler
  implements ReservationEventHandler {

  async handle(
    event: ReservationEvent,
  ): Promise<void> {

    logger.info(
      "Reservation Event",
      {
        type: event.type,
        tenantId: event.tenantId,
        reservationId: event.reservationId,
        contactId: event.contactId,
        opportunityId: event.opportunityId,
      },
    );

  }

}
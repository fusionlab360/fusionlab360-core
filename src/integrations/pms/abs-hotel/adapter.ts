import type {
  RequestContext,
} from "../../../context";

import type {
  PMSResult,
} from "../../../core/pms/models/result";

import type {
  PMSEvent,
} from "../../../core/pms/models/reservation-event";

import type {
  PMSReservationEventAdapter,
} from "../../../core/pms/contracts";

import type {
  ABSReservationInput,
} from "./types";

function mapABSCalendarStatus(
  status?: string,
):
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | undefined {

  const normalized =
    String(
      status ?? "",
    )
      .trim()
      .toUpperCase();

  switch (normalized) {

    case "R":
      return "confirmed";

    case "C":
      return "checked_in";

    case "D":
      return "checked_out";

    default:
      return undefined;

  }
}

/**
 * ABS Hotel PMS adapter boundary.
 *
 * This adapter is intentionally limited to the
 * provider boundary at this milestone.
 *
 * ABS-specific parsing / field extraction will be
 * implemented only after the provider payload contract
 * is explicitly defined.
 */
export class ABSHotelAdapter
  implements PMSReservationEventAdapter {

  async execute<TResult = unknown>(
    _context: RequestContext,
    _command: {
      type: import("../../../core/pms/commands").PMSCommandType;
      payload: ABSReservationInput,
    },
  ): Promise<PMSResult<TResult>> {

    return {

      success: false,

      error:
        "ABS Hotel PMS adapter command execution is not implemented yet.",

    };

  }


  async toReservationEvent(
  _context: RequestContext,
  payload: ABSReservationInput,
): Promise<PMSResult<PMSEvent>> {

  if (
    !payload.reservationId
  ) {

    return {

      success: false,

      error:
        "ABS reservationId is required.",

    };

  }


  const lifecycle =
    mapABSCalendarStatus(
      payload.calendarStatus,
    );


  const eventType =
    lifecycle === "checked_in"
      ? "reservation.checked_in"
      : lifecycle === "checked_out"
        ? "reservation.checked_out"
        : "reservation.updated";


  const event: PMSEvent = {

    eventType,

    provider:
      "abs-hotel",

    providerIdentity: {

      provider:
        "abs-hotel",

      providerReservationId:
        payload.reservationId,

      providerCalendarId:
        payload.calendarReservationId,

      providerEditId:
        payload.editId,

        

    },

    reservation: {

      reservationId:
        payload.reservationId,

      otaReferenceNumber:
        payload.otaReferenceNumber,

        

      provider:
        "abs-hotel",

      checkIn:
        payload.checkIn,

      checkOut:
        payload.checkOut,

      firstName:
        payload.firstName ??
        payload.guestName ??
        "",

      lastName:
        payload.lastName,

      fullName:
        payload.guestName ??
        payload.firstName ??
        "",

      email:
        payload.email,

      phone:
        payload.phone,

      roomNumber:
        payload.roomNumber,

      roomType:
        payload.roomType,

      ratePlan:
        payload.ratePlan,

      hotelName:
        payload.hotelName,

          

    },

    lifecycle,

    occurredAt:
      new Date().toISOString(),

    revision:
      payload.revision,

  };


  return {

    success: true,

    data:
      event,

  };

}

}
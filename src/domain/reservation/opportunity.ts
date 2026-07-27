import type { ReservationPayload } from "./types";
import { ReservationStatus } from "./constants";

export interface ReservationOpportunity {
  contactId: string;

  guestName: string;

  reservationId?: string;

  provider?: string;

  roomType?: string;

  checkIn?: string;

  checkOut?: string;

  status: string;

  pipelineId: string;

  pipelineStageId: string;
}

export function mapReservationToOpportunity(
  reservation: ReservationPayload,
  contactId: string,
  pipelineId: string,
  pipelineStageId: string
): ReservationOpportunity {
  return {
    contactId,

    guestName: `${reservation.firstName} ${reservation.lastName}`.trim(),

    reservationId: reservation.reservationId,

    provider: reservation.provider,

    roomType: reservation.roomType,

    checkIn: reservation.checkIn,

    checkOut: reservation.checkOut,

    status: ReservationStatus.OPEN,

    pipelineId,

    pipelineStageId,
  };
}
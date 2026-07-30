import type { ReservationPayload } from "./types";
import { ReservationStatus } from "./constants";

export interface ReservationOpportunity {
  contactId: string;

  guestName: string;

  reservationId?: string;

  provider?: string;

  roomType?: string;
  roomNumber?: string;

  checkIn?: string;
  checkOut?: string;

  adults?: number;
  children?: number;

  channelSource?: string;

  bookingDate?: string;

  paymentStatus?: string;

  status: string;
}

export function mapReservationToOpportunity(
  reservation: ReservationPayload,
  contactId: string
): ReservationOpportunity {
  return {
    contactId,

    guestName: `${reservation.firstName} ${reservation.lastName ?? ""}`.trim(),

    reservationId: reservation.reservationId,

    provider: reservation.provider,

    roomType: reservation.roomType,
    roomNumber: reservation.roomNumber,

    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,

    adults: reservation.adults,
    children: reservation.children,

    channelSource: reservation.channelSource,

    bookingDate: reservation.bookingDate,

    paymentStatus: reservation.paymentStatus,

    status: reservation.status ?? ReservationStatus.OPEN,
  };
}
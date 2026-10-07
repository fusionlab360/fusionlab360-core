import type { ReservationPayload } from "./types";
import { ReservationStatus } from "./constants";

export interface ReservationOpportunity {
  contactId: string;

  guestName: string;

  reservationId: string;
  otaReferenceNumber?: string;

  provider?: string;

  roomType?: string;
  roomNumber?: string;
  ratePlan?: string;
  package?: string;

  checkIn?: string;
  checkOut?: string;

  adults?: number;
  children?: number;
  nights?: number;
  infants?: number;

  channelSource?: string;
  hotelId?: string;
  hotelName?: string;

  extractedAt?: string;

  bookingDate?: string;

  status: string;

  
}

export function mapReservationToOpportunity(
  reservation: ReservationPayload,
  contactId: string,
): ReservationOpportunity {

  return {
    contactId,

    // ----------------------------------
    // Opportunity
    // ----------------------------------

    guestName:
      `${reservation.firstName} ${reservation.lastName ?? ""}`.trim(),

    status:
      reservation.status ??
      ReservationStatus.OPEN,

    // ----------------------------------
    // Reservation
    // ----------------------------------

    reservationId:
      reservation.reservationId,

    otaReferenceNumber:
      reservation.otaReferenceNumber,

    provider:
      reservation.provider,

    bookingDate:
      reservation.bookingDate,

    extractedAt:
      reservation.extractedAt,

    // ----------------------------------
    // Stay
    // ----------------------------------

    checkIn:
      reservation.checkIn,

    checkOut:
      reservation.checkOut,

    nights:
      reservation.nights,

    // ----------------------------------
    // Occupancy
    // ----------------------------------

    adults:
      reservation.adults,

    children:
      reservation.children,

    infants:
      reservation.infants,

    // ----------------------------------
    // Room
    // ----------------------------------

    roomType:
      reservation.roomType,

    roomNumber:
      reservation.roomNumber,

    ratePlan:
      reservation.ratePlan,

    package:
      reservation.package,

    // ----------------------------------
    // Channel
    // ----------------------------------

    channelSource:
      reservation.channelSource,

    // ----------------------------------
    // Hotel
    // ----------------------------------

    hotelId:
      reservation.hotelId,

    hotelName:
      reservation.hotelName,
  };

}
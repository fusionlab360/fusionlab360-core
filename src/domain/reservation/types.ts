export interface ReservationPayload {

  // Source
  provider?: string;

  // Reservation
  reservationId: string;
  status?: string;

  // Guest
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;

  nationality?: string;

  identityNumber?: string;
  identityType?: string;

  // Stay
  checkIn?: string;
  checkOut?: string;

  roomType?: string;
  roomNumber?: string;

  adults?: number;
  children?: number;

  // Booking
  channelSource?: string;
  bookingDate?: string;

  paymentStatus?: string;

  // Metadata
  notes?: string;
  extractedAt?: string;
}
export interface ReservationPayload {

  // ----------------------------------------
  // Source
  // ----------------------------------------

  provider?: string;

  // ----------------------------------------
  // Reservation
  // ----------------------------------------

  reservationId: string;

  otaReferenceNumber?: string;

  status?: string;

  bookingDate?: string;
  createdAt?: string;
  modifiedAt?: string;

  checkIn?: string;
  checkOut?: string;

  nights?: number;

  adults?: number;
  children?: number;
  infants?: number;

  remarks?: string;
  specialRequests?: string;

  

  // ----------------------------------------
  // Guest
  // ----------------------------------------

  firstName: string;
  lastName?: string;
  fullName?: string;

  email?: string;
  phone?: string;

  passport?: string;

  identityNumber?: string;
  identityType?: string;

  nationality?: string;

  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;

  // ----------------------------------------
  // Room
  // ----------------------------------------

  roomType?: string;
  roomNumber?: string;

  ratePlan?: string;
  package?: string;

  // ----------------------------------------
  // Financial
  // ----------------------------------------

  totalAmount?: number;
  paidAmount?: number;
  balance?: number;

  currency?: string;

  paymentMethod?: string;
  paymentStatus?: string;

  // ----------------------------------------
  // Channel
  // ----------------------------------------

  channelSource?: string;

  ota?: string;
  travelAgent?: string;
  marketSegment?: string;

  // ----------------------------------------
  // Hotel
  // ----------------------------------------

  hotelId?: string;
  hotelName?: string;

  branchId?: string;
  branchName?: string;

  timezone?: string;
  hotelCountry?: string;

  // ----------------------------------------
  // Metadata
  // ----------------------------------------

  extractedAt?: string;

}
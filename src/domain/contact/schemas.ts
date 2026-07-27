export interface CreateContactRequest {
  id?: string;

  provider?: string;
  reservationId?: string;

  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;

  passportNo?: string;
  nationality?: string;
  roomType?: string;
  marketSegment?: string;

  checkIn?: string;
  checkOut?: string;
}
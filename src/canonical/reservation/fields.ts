export const ReservationFields = {

  // ----------------------------------------
  // Reservation
  // ----------------------------------------

  ReservationId: "reservation.id",
  OTAReferenceNumber: "reservation.otaReferenceNumber",

  BookingDate: "reservation.bookingDate",
  CheckIn: "reservation.checkIn",
  CheckOut: "reservation.checkOut",

  Nights: "reservation.nights",

  Adults: "reservation.adults",
  Children: "reservation.children",
  Infants: "reservation.infants",

  // ----------------------------------------
  // Guest
  // ----------------------------------------

  GuestName: "reservation.guestName",

  FirstName: "reservation.firstName",
  LastName: "reservation.lastName",

  Email: "reservation.email",
  Phone: "reservation.phone",

  Passport: "reservation.passport",

  IdentityNumber: "reservation.identityNumber",
  IdentityType: "reservation.identityType",

  Nationality: "reservation.nationality",

  Address: "reservation.address",
  City: "reservation.city",
  State: "reservation.state",
  Country: "reservation.country",
  PostalCode: "reservation.postalCode",

  // ----------------------------------------
  // Room
  // ----------------------------------------

  RoomType: "reservation.roomType",
  RoomNumber: "reservation.roomNumber",

  RatePlan: "reservation.ratePlan",
  Package: "reservation.package",

  // ----------------------------------------
  // Channel
  // ----------------------------------------

  ChannelSource: "reservation.channelSource",

  // ----------------------------------------
  // Hotel
  // ----------------------------------------

  HotelId: "reservation.hotelId",
  HotelName: "reservation.hotelName",

   // ----------------------------------------
  // Metadata
  // ----------------------------------------

  Provider: "reservation.provider",

  ExtractedAt: "reservation.extractedAt",

} as const;

export type ReservationField =
  typeof ReservationFields[keyof typeof ReservationFields];
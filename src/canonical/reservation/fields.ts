export const ReservationFields = {
  ReservationId: "reservation.id",
  GuestName: "reservation.guestName",
  Provider: "reservation.provider",

  RoomType: "reservation.roomType",
  RoomNumber: "reservation.roomNumber",

  CheckIn: "reservation.checkIn",
  CheckOut: "reservation.checkOut",

  BookingDate: "reservation.bookingDate",

  IdentityNumber: "reservation.identityNumber",
  IdentityType: "reservation.identityType",

  Nationality: "reservation.nationality",

  Adults: "reservation.adults",
  Children: "reservation.children",

  Status: "reservation.status",
  PaymentStatus: "reservation.paymentStatus",

  ChannelSource: "reservation.channelSource",
} as const;

export type ReservationField =
  typeof ReservationFields[keyof typeof ReservationFields];
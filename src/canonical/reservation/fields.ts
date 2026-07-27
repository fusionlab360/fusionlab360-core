export const ReservationFields = {
  ReservationId: "reservation.id",
  GuestName: "reservation.guestName",
  Provider: "reservation.provider",
  RoomType: "reservation.roomType",
  CheckIn: "reservation.checkIn",
  CheckOut: "reservation.checkOut",
  PassportNoIC: "reservation.passportNoIC",
  Nationality: "reservation.nationality"
} as const;

export type ReservationField =
  typeof ReservationFields[keyof typeof ReservationFields];
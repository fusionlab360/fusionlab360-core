import { ReservationFields } from "../../canonical/reservation";

export const GHL_CANONICAL_FIELD_MAP: Record<string, string> = {
  "Reservation ID": ReservationFields.ReservationId,
  "Provider": ReservationFields.Provider,
  "Room Type": ReservationFields.RoomType,
  "Room Number": ReservationFields.RoomNumber,
  "Check In": ReservationFields.CheckIn,
  "Check Out": ReservationFields.CheckOut,
  "Adults": ReservationFields.Adults,
  "Children": ReservationFields.Children,
  "Channel Source": ReservationFields.ChannelSource,
  "Payment Status": ReservationFields.PaymentStatus,
  "Booking Date": ReservationFields.BookingDate,
};
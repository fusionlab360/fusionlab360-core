import { ContactFields } from "../../canonical/contact";
import { ReservationFields } from "../../canonical/reservation";


export const GHL_CANONICAL_FIELD_MAP: Record<string, string> = {

  // -------------------------------------------------
  // CONTACT
  // -------------------------------------------------

  "First Name": ContactFields.FirstName,
  "Last Name": ContactFields.LastName,
  "Email": ContactFields.Email,
  "Phone": ContactFields.Phone,

  "Identity Number": ContactFields.IdentityNumber,
  "Identity Type": ContactFields.IdentityType,
  "Nationality": ContactFields.Nationality,

  "Address": ContactFields.Address,
  "City": ContactFields.City,
  "State": ContactFields.State,
  "Country": ContactFields.Country,
  "Postal Code": ContactFields.PostalCode,

  "DOB": ContactFields.DOB,

  // -------------------------------------------------
  // RESERVATION
  // -------------------------------------------------

  "Reservation ID": ReservationFields.ReservationId,
  "OTA Reference Number": ReservationFields.OTAReferenceNumber,
  
  "Provider": ReservationFields.Provider,

  "Room Type": ReservationFields.RoomType,
  "Room Number": ReservationFields.RoomNumber,
  
  "Rate Plan": ReservationFields.RatePlan,
  "Package": ReservationFields.Package,

  "Check In": ReservationFields.CheckIn,
  "Check Out": ReservationFields.CheckOut,

  "Adults": ReservationFields.Adults,
  "Children": ReservationFields.Children,

  "Channel Source": ReservationFields.ChannelSource,

  "Hotel ID": ReservationFields.HotelId,
  "Hotel Name": ReservationFields.HotelName,

"Extracted At": ReservationFields.ExtractedAt,
  "Booking Date": ReservationFields.BookingDate,

  "Nights": ReservationFields.Nights,

  "Infants": ReservationFields.Infants,

};
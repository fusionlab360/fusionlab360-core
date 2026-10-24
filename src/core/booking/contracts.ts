import type {
  IntegrationContext,
} from "../../context/integration";


/*
 * --------------------------------------------------
 * Booking type
 * --------------------------------------------------
 *
 * The Core supports two booking domains:
 *
 * appointment
 * accommodation
 *
 * Appointment:
 * doctor / therapist / service + time slot
 *
 * Accommodation:
 * property / room type / rate + date range
 */
export type BookingType =
  | "appointment"
  | "accommodation";

export interface PatientIdentity {
  fullName: string | null;
  identityNumber: string | null;
  phone: string | null;
  identityType?: string | null;
}

export interface PatientIdentityGateway {
  load(customerId: string): Promise<PatientIdentity>;
  update(customerId: string, identity: PatientIdentity): Promise<PatientIdentity>;
}

export type BookingField =
  | "customer.fullName"
  | "customer.identityNumber"
  | "customer.phone";

export type BookingPersistenceMode =
  | "none"
  | "optional"
  | "required";

export interface BookingOfferingFieldPolicy {
  requiredFields: BookingField[];
  persistence: {
    target?: "crm.contact" | "none";
    mode: BookingPersistenceMode;
  };
}

/**
 * Legacy appointment field requirements retained only for compatibility with
 * previously stored provider configuration. New code should use the generic
 * offering policy above.
 */
export type AppointmentPatientField =
  | "full_name"
  | "identity_number"
  | "phone";

export interface AppointmentPatientFieldRequirements {
  fields: AppointmentPatientField[];
  persistToContact?: boolean;
  requirePersistence?: boolean;
}


/*
 * --------------------------------------------------
 * Booking status
 * --------------------------------------------------
 */
export type BookingStatus =
  | "confirmed"
  | "pending"
  | "cancelled";


/*
 * --------------------------------------------------
 * Bookable offering
 * --------------------------------------------------
 *
 * Appointment example:
 *
 * id:
 *   calendar/service identifier
 *
 * type:
 *   appointment
 *
 * name:
 *   Physiotherapy
 *
 *
 * Hotel example:
 *
 * id:
 *   room type identifier
 *
 * type:
 *   accommodation
 *
 * name:
 *   Deluxe King Room
 */
export interface BookingOffering {

  id:
    string;

  type:
    BookingType;

  name:
    string;

  locationId?:
    string;

  propertyId?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}


/*
 * --------------------------------------------------
 * Availability request
 * --------------------------------------------------
 */
export interface BookingAvailabilityRequest {

  type:
    BookingType;

  offeringId:
    string;

  start:
    string;

  end:
    string;

  timezone?:
    string;

  durationMinutes?:
    number;

  adults?:
    number;

  children?:
    number;

  quantity?:
    number;

  resourceId?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}


/*
 * --------------------------------------------------
 * Availability slot
 * --------------------------------------------------
 */
export interface BookingAvailabilitySlot {

  start:
    string;

  end:
    string;

  available:
    boolean;

  offeringId?:
    string;

  resourceId?:
    string;

  resourceName?:
    string;

  price?:
    number;

  currency?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}


/*
 * --------------------------------------------------
 * Create booking request
 * --------------------------------------------------
 */
export interface CreateBookingRequest {

  type:
    BookingType;

  offeringId:
    string;

  customerId:
    string;

  start:
    string;

  end:
    string;

  adults?:
    number;

  children?:
    number;

  quantity?:
    number;

  resourceId?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}


/*
 * --------------------------------------------------
 * Booking result
 * --------------------------------------------------
 */
export interface BookingResult {

  bookingId:
    string;

  status:
    BookingStatus;

  type:
    BookingType;

  offeringId:
    string;

  customerId:
    string;

  start:
    string;

  end:
    string;

  confirmationCode?:
    string;

  price?:
    number;

  currency?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}


/*
 * --------------------------------------------------
 * Booking provider
 * --------------------------------------------------
 *
 * Provider adapters implement this contract.
 *
 * The Core never calls:
 *
 * GHL
 * PMS
 * Calendar APIs
 * Room APIs
 *
 * directly.
 */
export interface BookingProvider {

    supportsBookingType?(
    type:
      BookingType,
    ):
      boolean |
      Promise<boolean>;

  listOfferings(
    context:
      IntegrationContext,

    type:
      BookingType,
  ):
    Promise<
      BookingOffering[]
    >;


  getAvailability(
    context:
      IntegrationContext,

    request:
      BookingAvailabilityRequest,
  ):
    Promise<
      BookingAvailabilitySlot[]
    >;


  createBooking(
    context:
      IntegrationContext,

    request:
      CreateBookingRequest,
  ):
    Promise<
      BookingResult
    >;


  getBooking?(
    context:
      IntegrationContext,

    bookingId:
      string,
  ):
    Promise<
      BookingResult
    >;


  updateBooking?(
    context:
      IntegrationContext,

    bookingId:
      string,

    request:
      Partial<
        CreateBookingRequest
      >,
  ):
    Promise<
      BookingResult
    >;


  cancelBooking?(
    context:
      IntegrationContext,

    bookingId:
      string,
  ):
    Promise<
      BookingResult
    >;
}

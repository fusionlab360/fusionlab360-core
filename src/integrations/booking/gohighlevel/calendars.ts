import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";

import {
  getGHLCalendar,
} from "./calendar-details";

import type {
  GHLCalendarDetails,
} from "./calendar-details";
import type {
  BookingOfferingFieldPolicy,
  BookingField,
  AppointmentPatientField,
} from "../../../core/booking";

type AppointmentPatientPolicyResolution = {
  policy: BookingOfferingFieldPolicy | null;
  status: "valid" | "missing" | "invalid";
};

const LEGACY_FIELD_MAP: Record<Exclude<AppointmentPatientField, "phone">, BookingField> = {
  full_name: "customer.fullName",
  identity_number: "customer.identityNumber",
};

function resolveAppointmentPatientFields(
  context: IntegrationContext,
  calendarId: string,
): AppointmentPatientPolicyResolution {
  const providerConfiguration =
    context.tenant.integrations.crm.configuration?.providerConfiguration;
  if (!providerConfiguration || typeof providerConfiguration !== "object" || Array.isArray(providerConfiguration)) {
    return { policy: null, status: "missing" };
  }
  const providerRecord = providerConfiguration as Record<string, unknown>;
  const configuredCalendars = providerRecord.appointmentPatientFieldsByCalendar;
  const genericBooking = providerRecord.booking;
  const genericBookingRecord = genericBooking && typeof genericBooking === "object" && !Array.isArray(genericBooking)
    ? genericBooking as Record<string, unknown>
    : null;
  const genericOfferings = genericBookingRecord?.offerings;
  const genericOfferingsRecord = genericOfferings && typeof genericOfferings === "object" && !Array.isArray(genericOfferings)
    ? genericOfferings as Record<string, unknown>
    : null;
  const genericPolicy = genericOfferingsRecord?.[calendarId];
  if (genericBooking !== undefined) {
    if (!genericBookingRecord || !genericOfferingsRecord) {
      return { policy: null, status: "invalid" };
    }
    if (genericPolicy === undefined) return { policy: null, status: "missing" };
    if (typeof genericPolicy !== "object" || genericPolicy === null || Array.isArray(genericPolicy)) {
      return { policy: null, status: "invalid" };
    }
    const record = genericPolicy as Record<string, unknown>;
    const persistence = record.persistence;
    if (!Array.isArray(record.requiredFields) || !persistence || typeof persistence !== "object" || Array.isArray(persistence)) {
      return { policy: null, status: "invalid" };
    }
    const fields = record.requiredFields;
    if (!fields.every((field): field is BookingField => field === "customer.fullName" || field === "customer.identityNumber" || field === "customer.phone") || new Set(fields).size !== fields.length) {
      return { policy: null, status: "invalid" };
    }
    const persistenceRecord = persistence as Record<string, unknown>;
    const mode = persistenceRecord.mode;
    const target = persistenceRecord.target;
    if (mode !== "none" && mode !== "optional" && mode !== "required") {
      return { policy: null, status: "invalid" };
    }
    if (target !== undefined && target !== "crm.contact" && target !== "none") {
      return { policy: null, status: "invalid" };
    }
    if (mode !== "none" && target !== "crm.contact") {
      return { policy: null, status: "invalid" };
    }
    return {
      policy: {
        requiredFields: [...fields],
        persistence: { target: target as "crm.contact" | "none" | undefined, mode },
      },
      status: "valid",
    };
  }
  if (!configuredCalendars || typeof configuredCalendars !== "object" || Array.isArray(configuredCalendars)) {
    return { policy: null, status: "missing" };
  }
  const configured = (configuredCalendars as Record<string, unknown>)[calendarId];
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    return { policy: null, status: "missing" };
  }
  const record = configured as Record<string, unknown>;
  if (!Array.isArray(record.fields)) return { policy: null, status: "invalid" };
  const fields = record.fields.filter(
    (field): field is Exclude<AppointmentPatientField, "phone"> => field === "full_name" || field === "identity_number",
  );
  if (fields.length !== record.fields.length || new Set(fields).size !== fields.length) {
    return { policy: null, status: "invalid" };
  }
  const persistToContact = record.persistToContact === true;
  const requirePersistence = record.requirePersistence === true;
  if (requirePersistence && !persistToContact) return { policy: null, status: "invalid" };
  return {
    policy: {
      requiredFields: fields.map((field) => LEGACY_FIELD_MAP[field]),
      persistence: {
        target: persistToContact ? "crm.contact" : "none",
        mode: requirePersistence ? "required" : persistToContact ? "optional" : "none",
      },
    },
    status: "valid",
  };
}


/*
 * --------------------------------------------------
 * GHL Calendar
 * --------------------------------------------------
 */

interface GHLCalendar {

  id:
    string;

  name:
    string;

  locationId?:
    string;

  description?:
    string;

  slug?:
    string;

  calendarType?:
    string;

  isActive?:
    boolean;
}


/*
 * --------------------------------------------------
 * GHL Calendar List Response
 * --------------------------------------------------
 */

interface GHLCalendarsResponse {

  calendars:
    GHLCalendar[];
}


/*
 * --------------------------------------------------
 * Get calendars for current tenant/location
 * --------------------------------------------------
 */

export async function getGHLCalendars(
  context:
    IntegrationContext,
): Promise<
  GHLCalendar[]
> {

  const locationId =
    context
      .tenant
      .integrations
      .crm
      .credentials
      .locationId
      .trim();


  if (
    !locationId
  ) {

    throw new Error(
      "GoHighLevel location ID is missing from tenant configuration.",
    );
  }


  const response =
    await ghlFetchAuthenticated<GHLCalendarsResponse>(
      context,

      `/calendars/?locationId=${encodeURIComponent(
        locationId,
      )}`,

      {
        method:
          "GET",

        headers: {
          Version:
            "v3",
        },
      },
    );


  return Array.isArray(
    response.calendars,
  )
    ? response.calendars
    : [];
}


/*
 * --------------------------------------------------
 * Get calendars enriched with configuration
 * --------------------------------------------------
 *
 * This is the representation consumed by the generic
 * BookingProvider.
 *
 * Calendar configuration is intentionally kept inside
 * metadata so the generic Core does not become tied
 * to GHL-specific calendar properties.
 *
 * --------------------------------------------------
 */

export async function getGHLCalendarOfferings(
  context:
    IntegrationContext,
) {

  const calendars =
    await getGHLCalendars(
      context,
    );


  const offerings =
    [] as Array<{
      id:
        string;

      type:
        "appointment";

      name:
        string;

      locationId?:
        string;

      metadata:
        Record<
          string,
          unknown
        >;
    }>;


  for (
    const calendar of
      calendars
  ) {
    const locationId = context.tenant.integrations.crm.credentials.locationId;
    if (calendar.isActive === false || (calendar.locationId && calendar.locationId !== locationId)) {
      continue;
    }

    let details:
      GHLCalendarDetails |
      null =
      null;
    let detailsResolution: "loaded" | "unavailable" = "loaded";


    /*
     * ------------------------------------------------
     * Load detailed calendar configuration
     * ------------------------------------------------
     *
     * A failure on one calendar should not prevent
     * the remaining calendars from being returned.
     *
     * ------------------------------------------------
     */

    try {

      details =
        await getGHLCalendar(
          context,

          calendar.id,
        );

    } catch (
      error:
        unknown
    ) {
      detailsResolution = "unavailable";

      console.error(
        "Failed to load GHL calendar details",
        {
          calendarId:
            calendar.id,

          calendarName:
            calendar.name,

          error:
            error instanceof Error
              ? error.message
              : error,
        },
      );
    }


    /*
     * ------------------------------------------------
     * Build generic booking offering
     * ------------------------------------------------
     */

    if (details && (details.locationId !== locationId || details.isActive === false)) {
      continue;
    }

    const patientPolicy = resolveAppointmentPatientFields(context, calendar.id);
    offerings.push({

      id:
        calendar.id,

      type:
        "appointment",

      name:
        calendar.name,

      locationId:
        calendar.locationId,

      metadata: {

        description:
          calendar.description ??
          null,

        slug:
          calendar.slug ??
          null,

        calendarType:
          calendar.calendarType ??
          null,

        isActive:
          calendar.isActive ??
          null,


        /*
         * Booking duration
         */

        slotDuration:
          details?.slotDuration ??
          null,

        slotDurationUnit:
          details?.slotDurationUnit ??
          null,


        /*
         * Supported appointment durations
         */

        durationOptions:
          details?.durationOptions ??
          [],


        /*
         * Slot interval
         */

        slotInterval:
          details?.slotInterval ??
          null,

        slotIntervalUnit:
          details?.slotIntervalUnit ??
          null,


        /*
         * Slot buffers
         */

        slotBuffer:
          details?.slotBuffer ??
          null,

        slotBufferUnit:
          details?.slotBufferUnit ??
          null,

        preBuffer:
          details?.preBuffer ??
          null,

        preBufferUnit:
          details?.preBufferUnit ??
          null,


        /*
         * Calendar booking behavior
         */

        appointmentPerSlot:
          details?.appointmentPerSlot ??
          null,

        appointmentPerDay:
          details?.appointmentPerDay ??
          null,

        autoConfirm:
          details?.autoConfirm ??
          null,


        /*
         * Assigned team members
         */

        teamMembers:
          details?.teamMembers ??
          [],

        bookingFieldPolicy:
          patientPolicy.policy,
        bookingFieldPolicyStatus: patientPolicy.status,
        calendarDetailsStatus: detailsResolution,
      },
    });
  }


  return offerings;
}

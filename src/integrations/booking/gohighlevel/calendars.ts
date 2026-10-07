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

    let details:
      GHLCalendarDetails |
      null =
      null;


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
      },
    });
  }


  return offerings;
}
import type {
  IntegrationContext,
} from "../../../context/integration";

import type {
  BookingProvider,
  BookingOffering,
  BookingType,
  BookingAvailabilityRequest,
  BookingAvailabilitySlot,
  CreateBookingRequest,
  BookingResult,
} from "../../../core/booking";

import {
  getGHLCalendarOfferings,
} from "./calendars";

import {
  getGHLCalendar,
} from "./calendar-details";

import {
  getGHLAvailability,
} from "./availability";

import {
  createGHLAppointment,
  getGHLAppointment,
  updateGHLAppointment,
  cancelGHLAppointment,
} from "./appointments";

import type {
  GHLUpdateAppointmentRequest,
} from "./appointments";


/*
 * --------------------------------------------------
 * Convert GHL duration to minutes
 * --------------------------------------------------
 */

function durationToMinutes(
  value:
    number |
    undefined,

  unit:
    string |
    undefined,
):
  number |
  null {

  if (
    value ===
      undefined ||

    !Number.isFinite(
      value,
    ) ||

    value <=
      0
  ) {

    return null;
  }


  const normalizedUnit =
    (
      unit ??
      "mins"
    )
      .toLowerCase()
      .trim();


  if (
    normalizedUnit ===
      "hours" ||

    normalizedUnit ===
      "hour"
  ) {

    return (
      value *
      60
    );
  }


  return value;
}


/*
 * --------------------------------------------------
 * Resolve effective appointment duration
 * --------------------------------------------------
 *
 * Priority:
 *
 * 1. Explicit request duration
 * 2. Calendar default duration option
 * 3. Calendar slotDuration
 *
 * This keeps the provider configuration-driven.
 * --------------------------------------------------
 */

function resolveAppointmentDurationMinutes(
  request:
    BookingAvailabilityRequest,

  calendar:
    Awaited<
      ReturnType<
        typeof getGHLCalendar
      >
    >,
):
  number {

  /*
   * ----------------------------------------------
   * 1. Explicit caller duration
   * ----------------------------------------------
   */

  if (
    request.durationMinutes !==
      undefined &&

    request.durationMinutes >
      0
  ) {

    return request.durationMinutes;
  }


  /*
   * ----------------------------------------------
   * 2. Configured duration options
   * ----------------------------------------------
   */

  const durationOptions =
    calendar.durationOptions ??
    [];


  if (
    durationOptions.length >
    0
  ) {

    const defaultOption =
      durationOptions.find(
        (
          option,
        ) =>
          option.isDefault ===
          true,
      ) ??
      durationOptions[0];


    const optionMinutes =
      durationToMinutes(
        defaultOption?.duration,

        defaultOption?.durationUnit,
      );


    if (
      optionMinutes !==
      null
    ) {

      return optionMinutes;
    }
  }


  /*
   * ----------------------------------------------
   * 3. Calendar slot duration
   * ----------------------------------------------
   */

  const slotDurationMinutes =
    durationToMinutes(
      calendar.slotDuration,

      calendar.slotDurationUnit,
    );


  if (
    slotDurationMinutes !==
    null
  ) {

    return slotDurationMinutes;
  }


  throw new Error(
    `No usable appointment duration is configured for GHL calendar ${calendar.id}.`,
  );
}


/*
 * --------------------------------------------------
 * Normalize appointment status
 * --------------------------------------------------
 */

function normalizeBookingStatus(
  status:
    string |
    undefined,
):
  "confirmed" |
  "pending" |
  "cancelled" {

  if (
    status ===
      "cancelled"
  ) {

    return "cancelled";
  }


  if (
    status ===
      "confirmed"
  ) {

    return "confirmed";
  }


  return "pending";
}


/*
 * --------------------------------------------------
 * GoHighLevel Booking Provider
 * --------------------------------------------------
 */

export const goHighLevelBookingProvider:
  BookingProvider =
  {


    /*
     * ------------------------------------------------
     * List bookable offerings
     * ------------------------------------------------
     */

    async listOfferings(
      context:
        IntegrationContext,

      type:
        BookingType,
    ):
      Promise<
        BookingOffering[]
      > {

      if (
        type !==
        "appointment"
      ) {

        return [];
      }


      return getGHLCalendarOfferings(
        context,
      );
    },


    /*
     * ------------------------------------------------
     * Get appointment availability
     * ------------------------------------------------
     */

    async getAvailability(
      context:
        IntegrationContext,

      request:
        BookingAvailabilityRequest,
    ):
      Promise<
        BookingAvailabilitySlot[]
      > {

      /*
       * ----------------------------------------------
       * Only appointment booking is supported by
       * this GHL provider.
       * ----------------------------------------------
       */

      if (
        request.type !==
        "appointment"
      ) {

        throw new Error(
          "GoHighLevel booking provider currently supports appointment availability only.",
        );
      }


      /*
       * ----------------------------------------------
       * Validate dates
       * ----------------------------------------------
       */

      const startDate =
        new Date(
          request.start,
        );


      const endDate =
        new Date(
          request.end,
        );


      if (
        Number.isNaN(
          startDate.getTime(),
        )
      ) {

        throw new Error(
          "Invalid booking availability start date.",
        );
      }


      if (
        Number.isNaN(
          endDate.getTime(),
        )
      ) {

        throw new Error(
          "Invalid booking availability end date.",
        );
      }


      if (
        endDate.getTime() <
        startDate.getTime()
      ) {

        throw new Error(
          "Booking availability end date cannot be before start date.",
        );
      }


      /*
       * ----------------------------------------------
       * Load actual selected calendar configuration
       * ----------------------------------------------
       */

      const calendar =
        await getGHLCalendar(
          context,

          request.offeringId,
        );


      /*
       * ----------------------------------------------
       * Resolve effective appointment duration
       * ----------------------------------------------
       */

      const durationMinutes =
        resolveAppointmentDurationMinutes(
          request,

          calendar,
        );


      /*
       * ----------------------------------------------
       * Request GHL free slots
       * ----------------------------------------------
       */

      const response =
        await getGHLAvailability(
          context,

          request.offeringId,

          startDate.getTime(),

          endDate.getTime(),

          request.timezone,

          durationMinutes,
        );


      /*
       * ----------------------------------------------
       * Normalize provider response
       * ----------------------------------------------
       */

      const slots:
        BookingAvailabilitySlot[] =
        [];


      for (
        const [
          date,
          value,
        ] of Object.entries(
          response,
        )
      ) {

        for (
          const slot of
            value.slots ?? []
        ) {

          const start =
            new Date(
              slot,
            );


          if (
            Number.isNaN(
              start.getTime(),
            )
          ) {

            continue;
          }


          const end =
            new Date(
              start.getTime() +
              (
                durationMinutes *
                60 *
                1000
              ),
            );


          slots.push({

            start:
              start.toISOString(),

            end:
              end.toISOString(),

            available:
              true,

            offeringId:
              request.offeringId,

            metadata: {

              date,

              durationMinutes,

              slotInterval:
                calendar.slotInterval ??
                null,

              slotIntervalUnit:
                calendar.slotIntervalUnit ??
                null,

            },

          });
        }
      }


      return slots;
    },


    /*
     * ------------------------------------------------
     * Create booking
     * ------------------------------------------------
     */

    async createBooking(
      context:
        IntegrationContext,

      request:
        CreateBookingRequest,
    ):
      Promise<
        BookingResult
      > {

      /*
       * ----------------------------------------------
       * Validate type
       * ----------------------------------------------
       */

      if (
        request.type !==
        "appointment"
      ) {

        throw new Error(
          "GoHighLevel booking provider currently supports appointment booking only.",
        );
      }


      /*
       * ----------------------------------------------
       * Validate dates
       * ----------------------------------------------
       */

      const start =
        new Date(
          request.start,
        );


      const end =
        new Date(
          request.end,
        );


      if (
        Number.isNaN(
          start.getTime(),
        )
      ) {

        throw new Error(
          "Invalid appointment start time.",
        );
      }


      if (
        Number.isNaN(
          end.getTime(),
        )
      ) {

        throw new Error(
          "Invalid appointment end time.",
        );
      }


      if (
        end.getTime() <=
        start.getTime()
      ) {

        throw new Error(
          "Appointment end time must be after start time.",
        );
      }


      /*
       * ----------------------------------------------
       * Resolve tenant/location
       * ----------------------------------------------
       */

      const locationId =
        context.tenant
          .integrations
          .crm
          .credentials
          .locationId;


      if (
        !locationId
      ) {

        throw new Error(
          "GoHighLevel location ID is missing from tenant configuration.",
        );
      }


      /*
       * ----------------------------------------------
       * Create GHL appointment
       * ----------------------------------------------
       */

      const response =
        await createGHLAppointment(
          context,

          {

            title:
              "FusionLab360 Appointment",

            calendarId:
              request.offeringId,

            locationId,

            contactId:
              request.customerId,

            startTime:
              request.start,

            endTime:
              request.end,

            appointmentStatus:
              "confirmed",

          },
        );


      /*
       * ----------------------------------------------
       * Normalize result
       * ----------------------------------------------
       */

      return {

        bookingId:
          response.id,

        status:
          normalizeBookingStatus(
            response.appointmentStatus,
          ),

        type:
          "appointment",

        offeringId:
          request.offeringId,

        customerId:
          request.customerId,

        start:
          response.startTime ??
          request.start,

        end:
          response.endTime ??
          request.end,

        confirmationCode:
          response.id,

        metadata: {

          calendarId:
            response.calendarId,

          locationId:
            response.locationId,

          assignedUserId:
            response.assignedUserId ??
            null,

        },

      };
    },


    /*
     * ------------------------------------------------
     * Get booking
     * ------------------------------------------------
     */

    async getBooking(
      context:
        IntegrationContext,

      bookingId:
        string,
    ):
      Promise<
        BookingResult
      > {

      const response =
        await getGHLAppointment(
          context,

          bookingId,
        );


      return {

        bookingId:
          response.id,

        status:
          normalizeBookingStatus(
            response.appointmentStatus,
          ),

        type:
          "appointment",

        offeringId:
          response.calendarId,

        customerId:
          response.contactId,

        start:
          response.startTime,

        end:
          response.endTime ??
          response.startTime,

        confirmationCode:
          response.id,

        metadata: {

          locationId:
            response.locationId,

          assignedUserId:
            response.assignedUserId ??
            null,

        },

      };
    },


    /*
     * ------------------------------------------------
     * Update booking / reschedule
     * ------------------------------------------------
     */

    async updateBooking(
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
      > {

      const update:
        GHLUpdateAppointmentRequest =
        {};


      if (
        request.start
      ) {

        update.startTime =
          request.start;
      }


      if (
        request.end
      ) {

        update.endTime =
          request.end;
      }


      if (
        request.offeringId
      ) {

        update.calendarId =
          request.offeringId;
      }


      const response =
        await updateGHLAppointment(
          context,

          bookingId,

          update,
        );


      return {

        bookingId:
          response.id,

        status:
          normalizeBookingStatus(
            response.appointmentStatus,
          ),

        type:
          "appointment",

        offeringId:
          response.calendarId,

        customerId:
          response.contactId,

        start:
          response.startTime,

        end:
          response.endTime ??
          response.startTime,

        confirmationCode:
          response.id,

        metadata: {

          locationId:
            response.locationId,

          assignedUserId:
            response.assignedUserId ??
            null,

        },

      };
    },


    /*
     * ------------------------------------------------
     * Cancel booking
     * ------------------------------------------------
     */

    async cancelBooking(
      context:
        IntegrationContext,

      bookingId:
        string,
    ):
      Promise<
        BookingResult
      > {

      const response =
        await cancelGHLAppointment(
          context,

          bookingId,
        );


      return {

        bookingId:
          response.id,

        status:
          "cancelled",

        type:
          "appointment",

        offeringId:
          response.calendarId,

        customerId:
          response.contactId,

        start:
          response.startTime,

        end:
          response.endTime ??
          response.startTime,

        confirmationCode:
          response.id,

        metadata: {

          locationId:
            response.locationId,

          assignedUserId:
            response.assignedUserId ??
            null,

        },

      };
    },

  };
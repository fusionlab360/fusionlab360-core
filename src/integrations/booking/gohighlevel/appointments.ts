import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";


/*
 * --------------------------------------------------
 * Create appointment request
 * --------------------------------------------------
 */

interface GHLCreateAppointmentRequest {

  title:
    string;

  calendarId:
    string;

  locationId:
    string;

  contactId:
    string;

  startTime:
    string;

  endTime?:
    string;

  appointmentStatus?:
    string;

  assignedUserId?:
    string;

  description?:
    string;
}


/*
 * --------------------------------------------------
 * Update appointment request
 * --------------------------------------------------
 */

export interface GHLUpdateAppointmentRequest {

  title?:
    string;

  meetingLocationType?:
    string;

  meetingLocationId?:
    string;

  overrideLocationConfig?:
    boolean;

  appointmentStatus?:
    string;

  assignedUserId?:
    string;

  description?:
    string;

  address?:
    string;

  ignoreDateRange?:
    boolean;

  toNotify?:
    boolean;

  ignoreFreeSlotValidation?:
    boolean;

  rrule?:
    string;

  calendarId?:
    string;

  startTime?:
    string;

  endTime?:
    string;
}


/*
 * --------------------------------------------------
 * Appointment response
 * --------------------------------------------------
 */

export interface GHLAppointmentResponse {

  id:
    string;

  calendarId:
    string;

  locationId:
    string;

  contactId:
    string;

  startTime:
    string;

  endTime?:
    string;

  title:
    string;

  appointmentStatus?:
    string;

  assignedUserId?:
    string;

  description?:
    string;

  address?:
    string;

  dateAdded?:
    string;

  dateUpdated?:
    string;
}


/*
 * --------------------------------------------------
 * GET appointment response
 * --------------------------------------------------
 */

interface GHLGetAppointmentResponse {

  event?:
    GHLAppointmentResponse;

  appointment?:
    GHLAppointmentResponse;
}


/*
 * --------------------------------------------------
 * DELETE response
 * --------------------------------------------------
 *
 * Kept for future direct-event deletion support.
 * The AI cancellation flow currently uses the safer
 * appointmentStatus = "cancelled" update operation.
 * --------------------------------------------------
 */

interface GHLDeleteEventResponse {

  succeeded?:
    boolean;
}


/*
 * --------------------------------------------------
 * Normalize appointment response
 * --------------------------------------------------
 */

function normalizeAppointmentResponse(
  response:
    unknown,

  fallback?:
    {
      startTime:
        string;

      endTime?:
        string;
    },
):
  GHLAppointmentResponse {

  if (
    !response ||
    typeof response !==
      "object"
  ) {

    throw new Error(
      "GoHighLevel returned no usable appointment.",
    );
  }


  const raw =
    response as Record<
      string,
      unknown
    >;


  const candidate =
  raw.event &&
  typeof raw.event ===
    "object"
    ? raw.event as Record<
        string,
        unknown
      >

    : raw.appointment &&
        typeof raw.appointment ===
          "object"
      ? raw.appointment as Record<
          string,
          unknown
        >

      : raw;


  if (
    typeof candidate.id !==
      "string" ||

    typeof candidate.calendarId !==
      "string" ||

    typeof candidate.locationId !==
      "string" ||

    typeof candidate.contactId !==
      "string" ||

      (
    typeof candidate.startTime !==
      "string" &&

    typeof fallback?.startTime !==
      "string"
      ) ||

    typeof candidate.title !==
      "string"
  ) {

    throw new Error(
      "GoHighLevel returned no usable appointment.",
    );
  }


  return {
    id:
      candidate.id,

    calendarId:
      candidate.calendarId,

    locationId:
      candidate.locationId,

    contactId:
      candidate.contactId,

    startTime:
      typeof candidate.startTime ===
        "string"
        ? candidate.startTime
        : fallback!.startTime,

    ...(
        typeof candidate.endTime ===
          "string"

          ? {
              endTime:
                candidate.endTime,
            }

          : typeof fallback?.endTime ===
              "string"

            ? {
                endTime:
                  fallback.endTime,
              }

            : {}
      ),

    title:
      candidate.title,

    ...(typeof candidate.appointmentStatus ===
      "string"
      ? {
          appointmentStatus:
            candidate.appointmentStatus,
        }
      : {}),

    ...(typeof candidate.assignedUserId ===
      "string"
      ? {
          assignedUserId:
            candidate.assignedUserId,
        }
      : {}),

    ...(typeof candidate.description ===
      "string"
      ? {
          description:
            candidate.description,
        }
      : {}),

    ...(typeof candidate.address ===
      "string"
      ? {
          address:
            candidate.address,
        }
      : {}),

    ...(typeof candidate.dateAdded ===
      "string"
      ? {
          dateAdded:
            candidate.dateAdded,
        }
      : {}),

    ...(typeof candidate.dateUpdated ===
      "string"
      ? {
          dateUpdated:
            candidate.dateUpdated,
        }
      : {}),
  };
}


/*
 * --------------------------------------------------
 * Create appointment
 * --------------------------------------------------
 */

export async function createGHLAppointment(
  context:
    IntegrationContext,

  input:
    GHLCreateAppointmentRequest,
):
  Promise<
    GHLAppointmentResponse
  > {

  if (
    !input.calendarId.trim()
  ) {

    throw new Error(
      "Calendar ID is required.",
    );
  }


  if (
    !input.locationId.trim()
  ) {

    throw new Error(
      "Location ID is required.",
    );
  }


  if (
    !input.contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  if (
    !input.startTime.trim()
  ) {

    throw new Error(
      "Appointment start time is required.",
    );
  }


  const response =
    await ghlFetchAuthenticated<
      GHLAppointmentResponse
    >(
      context,

      "/calendars/events/appointments",

      {
        method:
          "POST",

        headers: {
          Version:
            "v3",
        },

        body:
          JSON.stringify({
            title:
              input.title,

            calendarId:
              input.calendarId,

            locationId:
              input.locationId,

            contactId:
              input.contactId,

            startTime:
              input.startTime,

            ...(input.endTime
              ? {
                  endTime:
                    input.endTime,
                }
              : {}),

            ...(input.appointmentStatus
              ? {
                  appointmentStatus:
                    input.appointmentStatus,
                }
              : {}),

            ...(input.assignedUserId
              ? {
                  assignedUserId:
                    input.assignedUserId,
                }
              : {}),

            ...(input.description
              ? {
                  description:
                    input.description,
                }
              : {}),
          }),
      },
    );


  console.log(
    "GHL CREATE APPOINTMENT RAW RESPONSE",
    {
      responseType:
        typeof response,

      topLevelKeys:
        response &&
        typeof response ===
          "object"
          ? Object.keys(
              response as unknown as Record<
                string,
                unknown
              >,
            )
          : [],

      response:
        response,
    },
  );


  return normalizeAppointmentResponse(
      response,

      {
        startTime:
          input.startTime,

        ...(input.endTime
          ? {
              endTime:
                input.endTime,
            }
          : {}),
      },
    );
}

/*
 * --------------------------------------------------
 * Get appointment
 * --------------------------------------------------
 */

export async function getGHLAppointment(
  context:
    IntegrationContext,

  appointmentId:
    string,
):
  Promise<
    GHLAppointmentResponse
  > {

  if (
    !appointmentId.trim()
  ) {

    throw new Error(
      "Appointment ID is required.",
    );
  }


  const response =
    await ghlFetchAuthenticated<
      GHLGetAppointmentResponse
    >(
      context,

      `/calendars/events/appointments/${encodeURIComponent(
        appointmentId,
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


console.log(
  "GHL GET APPOINTMENT RAW RESPONSE",
  {
    appointmentId:
      appointmentId,

    responseType:
      typeof response,

    topLevelKeys:
      response &&
      typeof response ===
        "object"
        ? Object.keys(
            response as unknown as Record<
              string,
              unknown
            >,
          )
        : [],

    response:
      response,
  },
);


return normalizeAppointmentResponse(
  response,
);

}

/*
 * --------------------------------------------------
 * Update appointment
 * --------------------------------------------------
 */

export async function updateGHLAppointment(
  context:
    IntegrationContext,

  appointmentId:
    string,

  input:
    GHLUpdateAppointmentRequest,
):
  Promise<
    GHLAppointmentResponse
  > {

  if (
    !appointmentId.trim()
  ) {

    throw new Error(
      "Appointment ID is required.",
    );
  }


  const hasUpdate =
    Object.values(
      input,
    ).some(
      (
        value,
      ) =>
        value !==
        undefined,
    );


  if (
    !hasUpdate
  ) {

    throw new Error(
      "At least one appointment field is required for an update.",
    );
  }


  const response =
    await ghlFetchAuthenticated<
      GHLAppointmentResponse
    >(
      context,

      `/calendars/events/appointments/${encodeURIComponent(
        appointmentId,
      )}`,

      {
        method:
          "PUT",

        headers: {
          Version:
            "v3",
        },

        body:
          JSON.stringify(
            input,
          ),
      },
    );

    console.log(
  "GHL UPDATE APPOINTMENT RAW RESPONSE",
  {
    appointmentId:
      appointmentId,

    updateInput:
      input,

    responseType:
      typeof response,

    topLevelKeys:
      response &&
      typeof response ===
        "object"
        ? Object.keys(
            response as unknown as Record<
              string,
              unknown
            >,
          )
        : [],

    response:
      response,
  },
);


return normalizeAppointmentResponse(
  response,
);
}


/*
 * --------------------------------------------------
 * Cancel appointment
 * --------------------------------------------------
 *
 * HighLevel supports cancellation by updating the
 * appointment status to "cancelled".
 * --------------------------------------------------
 */

export async function cancelGHLAppointment(
  context:
    IntegrationContext,

  appointmentId:
    string,
):
  Promise<
    GHLAppointmentResponse
  > {

  if (
    !appointmentId.trim()
  ) {

    throw new Error(
      "Appointment ID is required.",
    );
  }


  return updateGHLAppointment(
    context,

    appointmentId,

    {
      appointmentStatus:
        "cancelled",

      toNotify:
        true,
    },
  );
}
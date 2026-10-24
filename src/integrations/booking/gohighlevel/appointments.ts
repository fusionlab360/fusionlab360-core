import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";
import { logger } from "../../../core/logger";


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

export interface GHLAppointmentNormalizationDiagnostics {
  envelopeType: "event" | "appointment" | "root" | "invalid";
  requiredFields: Record<"id" | "calendarId" | "locationId" | "contactId" | "startTime" | "title", boolean>;
  failureCategory: "invalid_response" | "missing_required_fields" | null;
}

export class GHLAppointmentNormalizationError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: GHLAppointmentNormalizationDiagnostics,
  ) {
    super(message);
    this.name = "GHLAppointmentNormalizationError";
  }
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
  diagnosticContext?: {
    stage: "pre_get" | "mutation" | "post_get";
    correlationId: string;
    appointmentId: string;
  },
):
  GHLAppointmentResponse {

  const envelopeType =
    response && typeof response === "object"
      ? (() => {
          const raw = response as Record<string, unknown>;
          return raw.event && typeof raw.event === "object"
            ? "event"
            : raw.appointment && typeof raw.appointment === "object"
              ? "appointment"
              : "root";
        })()
      : "invalid";

  const raw = response && typeof response === "object"
    ? response as Record<string, unknown>
    : null;
  const candidate = raw && envelopeType === "event"
    ? raw.event as Record<string, unknown>
    : raw && envelopeType === "appointment"
      ? raw.appointment as Record<string, unknown>
      : raw;
  const requiredFields = {
    id: typeof candidate?.id === "string",
    calendarId: typeof candidate?.calendarId === "string",
    locationId: typeof candidate?.locationId === "string",
    contactId: typeof candidate?.contactId === "string",
    startTime: typeof candidate?.startTime === "string" || typeof fallback?.startTime === "string",
    title: typeof candidate?.title === "string",
  };
  const failureCategory = envelopeType === "invalid"
    ? "invalid_response"
    : Object.values(requiredFields).every(Boolean)
      ? null
      : "missing_required_fields";

  if (diagnosticContext) {
    (failureCategory ? logger.warn : logger.info)("GHL appointment normalization diagnostics", {
      ...diagnosticContext,
      httpStatus: null,
      envelopeType,
      requiredFields,
      failureCategory,
    });
  }

  if (
    failureCategory === "invalid_response"
  ) {
    throw new GHLAppointmentNormalizationError("GoHighLevel returned no usable appointment.", {
      envelopeType,
      requiredFields,
      failureCategory,
    });
  }


  if (failureCategory === "missing_required_fields") {
    throw new GHLAppointmentNormalizationError("GoHighLevel returned no usable appointment.", {
      envelopeType,
      requiredFields,
      failureCategory,
    });
  }

  const validCandidate = candidate as Record<string, unknown>;

  return {
    id:
      validCandidate.id as string,

    calendarId:
      validCandidate.calendarId as string,

    locationId:
      validCandidate.locationId as string,

    contactId:
      validCandidate.contactId as string,

    startTime:
      typeof validCandidate.startTime ===
        "string"
        ? validCandidate.startTime
        : fallback!.startTime,

    ...(
        typeof validCandidate.endTime ===
          "string"

          ? {
              endTime:
                validCandidate.endTime as string,
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
      validCandidate.title as string,

    ...(typeof validCandidate.appointmentStatus ===
      "string"
      ? {
          appointmentStatus:
            validCandidate.appointmentStatus,
        }
      : {}),

    ...(typeof validCandidate.assignedUserId ===
      "string"
      ? {
          assignedUserId:
            validCandidate.assignedUserId,
        }
      : {}),

    ...(typeof validCandidate.description ===
      "string"
      ? {
          description:
            validCandidate.description,
        }
      : {}),

    ...(typeof validCandidate.address ===
      "string"
      ? {
          address:
            validCandidate.address,
        }
      : {}),

    ...(typeof validCandidate.dateAdded ===
      "string"
      ? {
          dateAdded:
            validCandidate.dateAdded,
        }
      : {}),

    ...(typeof validCandidate.dateUpdated ===
      "string"
      ? {
          dateUpdated:
            validCandidate.dateUpdated,
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

  return normalizeAppointmentResponse(
  response,
  undefined,
  {
    stage: "mutation",
    correlationId: context.requestId,
    appointmentId,
  },
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

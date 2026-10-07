import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";


export interface GHLDurationOption {

  duration:
    number;

  durationUnit:
    "mins"
    | "hours";

  isDefault?:
    boolean;

  order?:
    number;
}


export interface GHLCalendarDetails {

  id:
    string;

  name:
    string;

  locationId:
    string;

  calendarType?:
    string;

  isActive?:
    boolean;

  slotDuration?:
    number;

  slotDurationUnit?:
    "mins"
    | "hours";

  durationOptions?:
    GHLDurationOption[];

  slotInterval?:
    number;

  slotIntervalUnit?:
    "mins"
    | "hours";

  slotBuffer?:
    number;

  slotBufferUnit?:
    "mins"
    | "hours";

  preBuffer?:
    number;

  preBufferUnit?:
    "mins"
    | "hours";

  appointmentPerSlot?:
    number;

  appointmentPerDay?:
    number;

  autoConfirm?:
    boolean;

  teamMembers?:
    Array<{
      userId?:
        string;

      priority?:
        number;

      isPrimary?:
        boolean;
    }>;

  metadata?:
    Record<
      string,
      unknown
    >;
}


interface GHLCalendarResponse {

  calendar:
    GHLCalendarDetails;
}


export async function getGHLCalendar(
  context:
    IntegrationContext,

  calendarId:
    string,
): Promise<
  GHLCalendarDetails
> {

  if (
    !calendarId.trim()
  ) {

    throw new Error(
      "Calendar ID is required.",
    );
  }


  const response =
    await ghlFetchAuthenticated<GHLCalendarResponse>(
      context,

      `/calendars/${encodeURIComponent(
        calendarId,
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


  if (
    !response.calendar
  ) {

    throw new Error(
      `GHL calendar ${calendarId} was not returned.`,
    );
  }


  return response.calendar;
}
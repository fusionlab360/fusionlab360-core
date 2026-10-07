import {
  ghlFetchAuthenticated,
} from "../../crm/gohighlevel/client";

import type {
  IntegrationContext,
} from "../../../context/integration";


interface GHLFreeSlotsResponse {

  [date:
    string]:
    {
      slots?:
        string[];
    };
}


export async function getGHLAvailability(
  context:
    IntegrationContext,

  calendarId:
    string,

  startDate:
    number,

  endDate:
    number,

  timezone?:
    string,

  duration?:
    number,
): Promise<
  GHLFreeSlotsResponse
> {

  if (
    !calendarId.trim()
  ) {

    throw new Error(
      "Calendar ID is required.",
    );
  }


  if (
    endDate <
    startDate
  ) {

    throw new Error(
      "Availability end date cannot be before start date.",
    );
  }


  const params =
    new URLSearchParams();


  params.set(
    "startDate",
    String(
      startDate,
    ),
  );


  params.set(
    "endDate",
    String(
      endDate,
    ),
  );


  if (
    timezone?.trim()
  ) {

    params.set(
      "timezone",
      timezone.trim(),
    );
  }


  if (
    duration !==
    undefined
  ) {

    params.set(
      "duration",
      String(
        duration,
      ),
    );
  }


  return ghlFetchAuthenticated<GHLFreeSlotsResponse>(
    context,

    `/calendars/${encodeURIComponent(
      calendarId,
    )}/free-slots?${params.toString()}`,

    {
      method:
        "GET",

      headers: {
        Version:
          "v3",
      },
    },
  );
}
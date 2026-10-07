import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  GHLOpportunity,
} from "../types";

import type {
  RequestContext,
} from "../../../../context";


function getLocationId(
  context:
    RequestContext,
): string {

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
      "Missing GoHighLevel location ID.",
    );
  }


  return locationId;
}


/*
 * --------------------------------------------------
 * Search opportunities by Contact ID
 * --------------------------------------------------
 */

export function searchOpportunity(
  context:
    RequestContext,

  contactId:
    string,
) {

  if (
    !contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  const locationId =
    getLocationId(
      context,
    );


  const endpoint =
    `${GHL.ENDPOINTS.OPPORTUNITIES}/search` +
    `?locationId=${encodeURIComponent(
      locationId,
    )}` +
    `&contactId=${encodeURIComponent(
      contactId,
    )}`;


  return ghlFetchAuthenticated<{
    opportunities?:
      GHLOpportunity[];
  }>(
    context,

    endpoint,

    {
      method:
        "GET",
    },
  );
}


/*
 * --------------------------------------------------
 * Find opportunity by Reservation ID field
 * --------------------------------------------------
 */

export async function findReservationOpportunity(
  context:
    RequestContext,

  contactId:
    string,

  reservationFieldId:
    string,

  reservationId:
    string,
): Promise<
  GHLOpportunity |
  undefined
> {

  if (
    !reservationFieldId.trim()
  ) {

    throw new Error(
      "Reservation field ID is required.",
    );
  }


  if (
    !reservationId.trim()
  ) {

    throw new Error(
      "Reservation ID is required.",
    );
  }


  const response =
    await searchOpportunity(
      context,

      contactId,
    );


  return response
    .opportunities
    ?.find(
      (
        opportunity,
      ) =>
        opportunity
          .customFields
          ?.some(
            (
              field,
            ) =>
              field.id ===
                reservationFieldId &&

              field.field_value ===
                reservationId,
          ),
    );
}
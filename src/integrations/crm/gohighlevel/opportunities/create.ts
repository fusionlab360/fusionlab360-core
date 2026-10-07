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


/*
 * --------------------------------------------------
 * Create Reservation Opportunity
 * --------------------------------------------------
 *
 * The Core reservation lifecycle exposes this as a
 * "create" operation.
 *
 * HighLevel is called through the supported
 * /opportunities/upsert endpoint.
 *
 * Core controls duplication through reservation_links
 * and the reservation lifecycle before reaching this
 * method.
 */

export function createOpportunity(
  context:
    RequestContext,

  payload:
    GHLOpportunity,
) {

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


  return ghlFetchAuthenticated<{
    opportunity:
      GHLOpportunity;
  }>(
    context,

    GHL.ENDPOINTS.OPPORTUNITIES_UPSERT,

    {
      method:
        "POST",

      body:
        JSON.stringify({
          locationId,

          ...payload,
        }),
    },
  );
}
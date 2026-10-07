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


export function upsertOpportunity(
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
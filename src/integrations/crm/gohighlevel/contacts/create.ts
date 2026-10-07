import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  GHLContact,
} from "../types";

import type {
  RequestContext,
} from "../../../../context";


export async function createContact(
  context:
    RequestContext,

  payload:
    GHLContact,
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
      "GoHighLevel location ID is missing from tenant configuration.",
    );
  }


  return ghlFetchAuthenticated<{
    contact:
      GHLContact;
  }>(
    context,

    GHL.ENDPOINTS.CONTACTS,

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
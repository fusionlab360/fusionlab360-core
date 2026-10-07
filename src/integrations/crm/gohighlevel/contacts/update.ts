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


export function updateContact(
  context:
    RequestContext,

  contactId:
    string,

  payload:
    Partial<GHLContact>,
) {

  if (
    !contactId.trim()
  ) {

    throw new Error(
      "Contact ID is required.",
    );
  }


  return ghlFetchAuthenticated<{
    contact:
      GHLContact;
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/${encodeURIComponent(
      contactId,
    )}`,

    {
      method:
        "PUT",

      body:
        JSON.stringify(
          payload,
        ),
    },
  );
}

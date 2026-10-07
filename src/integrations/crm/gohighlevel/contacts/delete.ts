import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  RequestContext,
} from "../../../../context";


export function deleteContact(
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


  return ghlFetchAuthenticated<{
    succeeded:
      boolean;
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/${encodeURIComponent(
      contactId,
    )}`,

    {
      method:
        "DELETE",
    },
  );
}
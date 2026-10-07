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


export function searchContact(
  context:
    RequestContext,

  email:
    string,
) {

  if (
    !email.trim()
  ) {

    throw new Error(
      "Email is required.",
    );
  }


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


  const endpoint =
    `${GHL.ENDPOINTS.CONTACTS}/search/duplicate` +
    `?locationId=${encodeURIComponent(
      locationId,
    )}` +
    `&email=${encodeURIComponent(
      email.trim(),
    )}`;


  return ghlFetchAuthenticated<{
    contact?:
      GHLContact;

    duplicate:
      boolean;
  }>(
    context,

    endpoint,
  );
}
import {
  ghlFetchAuthenticated,
} from "../client";

import {
  GHL,
} from "../config";

import type {
  GHLContact,
} from "../types";

import {
  logger,
} from "../../../../core/logger";

import type {
  RequestContext,
} from "../../../../context";


/**
 * Upsert a GoHighLevel contact.
 *
 * This function is intentionally transport-only.
 * Business logic, retries and error recovery belong
 * to the service/adapter layer.
 */
export async function upsertContact(
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
      "Missing GoHighLevel location ID.",
    );
  }


  logger.info(
    "FINAL GHL UPSERT PAYLOAD",
    {
      payload: {
        locationId,

        ...payload,
      },
    },
  );


  logger.info(
    "FINAL GHL UPSERT REQUEST START",
    {
      endpoint:
        `${GHL.ENDPOINTS.CONTACTS}/upsert`,

      locationId,
    },
  );


  return ghlFetchAuthenticated<{
    contact:
      GHLContact;
  }>(
    context,

    `${GHL.ENDPOINTS.CONTACTS}/upsert`,

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
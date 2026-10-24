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


  logger.info("GHL contact upsert payload prepared", {
    operation: "contact.upsert",
    provider: "gohighlevel",
    correlationId: context.requestId,
    locationId,
    emailPresent: Boolean(payload.email),
    phonePresent: Boolean(payload.phone),
    customFieldCount: payload.customFields?.length ?? 0,
  });


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

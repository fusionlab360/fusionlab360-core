import type { RequestContext } from "../../context";

import { resolveCRMAdapter } from "../../core/crm";

import { validateReservation } from "./validator";
import { mapReservationToContact } from "./mapper";
import { mapReservationToOpportunity } from "./opportunity";

import type { ReservationPayload } from "./types";
import type { ReservationResult } from "./result";

import {
  ContactSyncFailedError,
  OpportunitySyncFailedError,
} from "./errors";

export async function processReservation(
  context: RequestContext,
  payload: ReservationPayload
): Promise<ReservationResult> {
  // 1. Validate Reservation
  const reservation = validateReservation(payload);

  // 2. Resolve CRM Adapter
  const crmAdapter = resolveCRMAdapter(context.tenant);

  // 3. Reservation -> Contact
  let contact;

  try {
    contact = await crmAdapter.upsertContact(
      context,
      mapReservationToContact(reservation)
    );
  } catch (error) {
    console.error("===== CONTACT SYNC FAILED =====");
    console.error(error);

    throw new ContactSyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize contact."
    );
  }

  if (!contact.id) {
    throw new ContactSyncFailedError();
  }

  // 4. Reservation -> Opportunity (Canonical)
  const opportunity = mapReservationToOpportunity(
    reservation,
    contact.id
  );

  // 5. CRM Adapter handles pipeline/stage mapping internally
  let opportunityResult;

  try {
    opportunityResult = await crmAdapter.upsertOpportunity(
      context,
      opportunity
    );
  } catch (error) {
    console.error("===== OPPORTUNITY SYNC FAILED =====");
    console.error(error);

    throw new OpportunitySyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize opportunity."
    );
  }

  if (!opportunityResult.id) {
    throw new OpportunitySyncFailedError();
  }

  // 6. Return Result
  return {
    success: true,
    message: "Reservation synced successfully.",
    contactId: contact.id,
    opportunityId: opportunityResult.id,
  };
}
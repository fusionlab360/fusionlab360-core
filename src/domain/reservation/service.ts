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
  const contact = await crmAdapter.upsertContact(
    context,
    mapReservationToContact(reservation)
  );

  if (!contact.id) {
    throw new ContactSyncFailedError();
  }

  // 4. Read CRM configuration
  const crm = context.tenant.integrations.crm;

  const pipeline = crm.configuration.pipelines.primary;

  // 5. Reservation -> Opportunity
  const opportunity = mapReservationToOpportunity(
    reservation,
    contact.id,
    pipeline.id,
    pipeline.stageId
  );

const opportunityResult =
  await crmAdapter.upsertOpportunity(
    context,
    opportunity
  );

if (!opportunityResult.id) {
  throw new OpportunitySyncFailedError();
}

  // 8. Return Result
  return {
  success: true,
  message: "Reservation synced successfully.",
  contactId: contact.id,
  opportunityId: opportunityResult.id,
};
}
import type { RequestContext } from "../../context";

import { resolveCRMAdapter } from "../../core/crm";
import { logger } from "../../core/logger";

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

  // ===========================================
// DEBUG - Incoming Payload
// ===========================================

logger.info("========== INCOMING REQUEST ==========");

logger.info("Payload Keys", {
  keys: Object.keys(payload ?? {}),
});

logger.info("Payload JSON", {
  json: JSON.stringify(payload, null, 2),
});

// ===========================================
// Validate reservation
// ===========================================

const reservation = validateReservation(payload);

  logger.info("Reservation sync started", {
    tenantId: context.tenant.id,
    reservationId: reservation.reservationId,
    provider: reservation.provider,
  });

  // Resolve CRM adapter
  const crmAdapter = resolveCRMAdapter(context.tenant);

  // Contact Sync
  let contact;

  try {
    logger.debug("Upserting contact");

    contact = await crmAdapter.upsertContact(
      context,
      mapReservationToContact(reservation)
    );

    logger.info("Contact upsert completed", {
      contactId: contact.id,
    });
  } catch (error) {
    logger.error("Contact sync failed", {
      tenantId: context.tenant.id,
      reservationId: reservation.reservationId,
      error,
    });

    throw new ContactSyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize contact."
    );
  }

  if (!contact.id) {
    logger.error("Contact sync returned empty contact ID", {
      tenantId: context.tenant.id,
      reservationId: reservation.reservationId,
    });

    throw new ContactSyncFailedError();
  }

  // Opportunity Mapping
  logger.debug("Building opportunity");

  const opportunity = mapReservationToOpportunity(
    reservation,
    contact.id
  );

  // Opportunity Sync
  let opportunityResult;

  try {
    logger.debug("Upserting opportunity");

    opportunityResult = await crmAdapter.upsertOpportunity(
      context,
      opportunity
    );

    logger.info("Opportunity upsert completed", {
      opportunityId: opportunityResult.id,
    });
  } catch (error) {
    logger.error("Opportunity sync failed", {
      tenantId: context.tenant.id,
      reservationId: reservation.reservationId,
      error,
    });

    throw new OpportunitySyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize opportunity."
    );
  }

  if (!opportunityResult.id) {
    logger.error("Opportunity sync returned empty opportunity ID", {
      tenantId: context.tenant.id,
      reservationId: reservation.reservationId,
    });

    throw new OpportunitySyncFailedError();
  }

  logger.info("Reservation sync completed", {
    tenantId: context.tenant.id,
    reservationId: reservation.reservationId,
    contactId: contact.id,
    opportunityId: opportunityResult.id,
  });

  return {
    success: true,
    message: "Reservation synced successfully.",
    contactId: contact.id,
    opportunityId: opportunityResult.id,
  };
}
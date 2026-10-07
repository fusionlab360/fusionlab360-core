import type { RequestContext } from "../../context";

import {
  reservationLifecycleService,
} from "./lifecycle-service";

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

import {
  buildProductionReservationEvent,
} from "./production-event-bridge";

import {
  ReservationOrchestrator,
} from "./orchestrator";

import {
  createRepositories,
} from "../../persistence/factory";


export async function processReservation(
  db: D1Database,
  context: RequestContext,
  payload: ReservationPayload,
): Promise<ReservationResult> {

  // ===========================================
  // DEBUG - Incoming Payload
  // ===========================================

  logger.info(
    "========== INCOMING REQUEST ==========",
  );

  logger.info(
    "Payload Keys",
    {
      keys: Object.keys(payload ?? {}),
    },
  );

  logger.info(
    "Payload JSON",
    {
      json: JSON.stringify(
        payload,
        null,
        2,
      ),
    },
  );


  // ===========================================
  // Validate reservation
  // ===========================================

  const reservation =
    validateReservation(
      payload,
    );


  logger.info(
    "Reservation sync started",
    {
      tenantId:
        context.tenant.id,

      reservationId:
        reservation.reservationId,

      provider:
        reservation.provider,
    },
  );


  const crmAdapter =
    resolveCRMAdapter(
      context.tenant,
    );


  // ===========================================
  // CONTACT
  // ===========================================

  let contact;


  try {

    logger.debug(
      "Upserting contact",
    );


    contact =
      await crmAdapter.upsertContact(
        context,
        mapReservationToContact(
          reservation,
        ),
      );


    logger.info(
      "Contact upsert completed",
      {
        contactId:
          contact.id,
      },
    );

  } catch (error) {

    logger.error(
      "Contact sync failed",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,

        error,
      },
    );


    throw new ContactSyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize contact.",
    );
  }


  if (!contact.id) {

    logger.error(
      "Contact sync returned empty contact ID",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,
      },
    );


    throw new ContactSyncFailedError();
  }


  // ===========================================
  // OPPORTUNITY LIFECYCLE
  //
  // Historical cancelled reservation protection:
  //
  // A cancelled reservation must NOT enter the
  // legacy lifecycle service because that service
  // can recover/reuse the old cancelled GHL
  // opportunity.
  //
  // For a historical cancelled row:
  //   1. Create a fresh GHL opportunity
  //   2. Let the canonical orchestrator recycle
  //      the Core reservation_links identity
  //   3. Attach the fresh CRM identity
  //
  // Normal active reservations continue through
  // the existing lifecycle service unchanged.
  // ===========================================

  const opportunity =
    mapReservationToOpportunity(
      reservation,
      contact.id,
    );


  const repositories =
    createRepositories(
      db,
    );


  const existingReservationLink =
    await repositories
      .reservationLinkRepository
      .find(
        context.tenant.id,
        reservation.reservationId,
      );


  const historicalCancelled =
    existingReservationLink?.lifecycle ===
      "cancelled";


  let opportunityResult;


  try {

    if (
      historicalCancelled
    ) {

      logger.info(
        "Historical cancelled reservation detected - bypassing legacy opportunity lifecycle.",
        {
          tenantId:
            context.tenant.id,

          reservationId:
            reservation.reservationId,

          oldOpportunityId:
            existingReservationLink
              ?.opportunityId ??
            null,
        },
      );


      const freshOpportunity =
        await crmAdapter.createOpportunity(
          context,
          opportunity,
        );


      if (!freshOpportunity?.id) {

        throw new Error(
          "Fresh GHL opportunity creation returned no opportunity ID.",
        );

      }


      opportunityResult = {

        id:
          freshOpportunity.id,

        action:
          "created",

      };


      logger.info(
        "Fresh GHL opportunity created for historical cancelled reservation.",
        {
          tenantId:
            context.tenant.id,

          reservationId:
            reservation.reservationId,

          oldOpportunityId:
            existingReservationLink
              ?.opportunityId ??
            null,

          newOpportunityId:
            freshOpportunity.id,
        },
      );

    } else {

      logger.debug(
        "Synchronizing reservation lifecycle",
      );


      opportunityResult =
        await reservationLifecycleService
          .synchronize(
            db,
            context,
            opportunity,
          );


      logger.info(
        "Reservation lifecycle synchronized",
        {
          opportunityId:
            opportunityResult.id,

          action:
            opportunityResult.action,
        },
      );

    }

  } catch (error) {

    logger.error(
      "Opportunity lifecycle failed",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,

        historicalCancelled,

        error,
      },
    );


    throw new OpportunitySyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to synchronize reservation lifecycle.",
    );
  }


  if (!opportunityResult.id) {

    logger.error(
      "Reservation lifecycle returned empty opportunity ID",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,
      },
    );


    throw new OpportunitySyncFailedError();
  }

  // ===========================================
  // CANONICAL RESERVATION ORCHESTRATION
  // ===========================================

  let canonicalResult;


  try {

    logger.info(
      "Starting canonical reservation orchestration",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,

        contactId:
          contact.id,

        opportunityId:
          opportunityResult.id,
      },
    );


    const canonicalEvent =
      buildProductionReservationEvent(
        reservation,
      );


    const orchestrator =
      new ReservationOrchestrator();


    canonicalResult =
      await orchestrator.evaluate(
        db,
        context,
        canonicalEvent,
      );


    logger.info(
      "Canonical reservation orchestration completed",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,

        action:
          canonicalResult.action,

        canonicalReservationId:
          canonicalResult.canonicalReservationId,

        revision:
          canonicalResult.revision,

        lifecycle:
          canonicalResult.lifecycle,
      },
    );


  } catch (error) {

    logger.error(
      "Canonical reservation orchestration failed",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          reservation.reservationId,

        error,
      },
    );


    throw new OpportunitySyncFailedError(
      error instanceof Error
        ? error.message
        : "Canonical reservation orchestration failed.",
    );
  }


  // ===========================================
  // CRM IDENTITY BRIDGE
  //
  // The canonical orchestrator may have created
  // reservation_links before CRM reconciliation.
  //
  // Attach the existing GHL contact/opportunity
  // to that canonical reservation instead of
  // creating another reservation link.
  // ===========================================

  try {

    const repositories =
      createRepositories(
        db,
      );


    await repositories
      .reservationLinkRepository
      .updateCrmIdentity(
        context.tenant.id,

        canonicalResult.reservationId,

        contact.id,

        opportunityResult.id,
      );


    logger.info(
      "CRM identity attached to canonical reservation",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          canonicalResult.reservationId,

        canonicalReservationId:
          canonicalResult.canonicalReservationId,

        contactId:
          contact.id,

        opportunityId:
          opportunityResult.id,
      },
    );

  } catch (error) {

    logger.error(
      "Failed to attach CRM identity to canonical reservation",
      {
        tenantId:
          context.tenant.id,

        reservationId:
          canonicalResult.reservationId,

        canonicalReservationId:
          canonicalResult.canonicalReservationId,

        contactId:
          contact.id,

        opportunityId:
          opportunityResult.id,

        error,
      },
    );


    throw new OpportunitySyncFailedError(
      error instanceof Error
        ? error.message
        : "Failed to attach CRM identity to reservation.",
    );
  }


  // ===========================================
  // COMPLETE
  // ===========================================

  logger.info(
    "Reservation sync completed",
    {
      tenantId:
        context.tenant.id,

      reservationId:
        reservation.reservationId,

      canonicalReservationId:
        canonicalResult.canonicalReservationId,

      contactId:
        contact.id,

      opportunityId:
        opportunityResult.id,

      lifecycle:
        canonicalResult.lifecycle,

      revision:
        canonicalResult.revision,
    },
  );


  return {

    success:
      true,

    message:
      "Reservation synced successfully.",

    contactId:
      contact.id,

    opportunityId:
      opportunityResult.id,

  };

}
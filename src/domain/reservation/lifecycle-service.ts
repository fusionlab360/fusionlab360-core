import type {
  RequestContext,
} from "../../context";


import {
  createRepositories,
} from "../../persistence/factory";


import {
  resolveCRMAdapter,
} from "../../core/crm";

import {
  ApiError,
} from "../../core/errors/ApiError";


import type {
  ReservationOpportunity,
} from "./opportunity";


import {
  resolveReservationLifecycle,
} from "./lifecycle";


import {
  resolveReservationStage,
} from "./stage";


import {
  createReservationOpportunity,
  attachReservationOpportunity,
  moveReservationOpportunity,
} from "./actions";


import {
  shouldMoveOpportunity,
} from "./transition";


import {
  dispatchReservationEvent,
} from "./event-dispatcher";


import type {
  ReservationEvent,
} from "./events";


export class ReservationLifecycleService {


  private async recoverOpportunityId(
  db:
    D1Database,

  context:
    RequestContext,

  opportunity:
    ReservationOpportunity,

  lifecycle:
    ReturnType<
      typeof resolveReservationLifecycle
    >,

):
  Promise<string> {

    const repositories =
      createRepositories(
        db,
      );


    /*
     * ----------------------------------------
     * STALE GHL OPPORTUNITY RECOVERY
     * ----------------------------------------
     *
     * Core has an opportunityId, but GHL may
     * no longer contain that opportunity.
     *
     * First try to locate the opportunity by
     * the reservation ID.
     */

    const existing =
      await resolveCRMAdapter(
        context.tenant,
      ).searchOpportunity(
        context,
        opportunity.contactId,
        opportunity.reservationId,
      );


    if (
      existing?.id
    ) {

      /*
       * ------------------------------------------------------------
       * CRM OPPORTUNITY OWNERSHIP CHECK
       * ------------------------------------------------------------
       *
       * The GHL search may return an opportunity that already
       * belongs to another Core reservation.
       *
       * Never reuse that opportunity.
       *
       * If it belongs to this reservation, it is safe to reuse.
       * If it belongs to another reservation, ignore the candidate
       * and continue to the existing "create replacement" path
       * below.
       */

      const existingOwner =
        await repositories
          .reservationLinkRepository
          .findByOpportunityId(
            context.tenant.id,

            existing.id,
          );


      if (
        existingOwner &&
        existingOwner.reservationId !==
          opportunity.reservationId
      ) {

        /*
         * Candidate belongs to another reservation.
         *
         * Do NOT attach it.
         *
         * Continue below so Core creates a new CRM opportunity
         * for the current reservation.
         */

      } else {

        await repositories
          .reservationLinkRepository
          .updateCrmIdentity(
            context.tenant.id,

            opportunity.reservationId,

            opportunity.contactId,

            existing.id,
          );


        return existing.id;

      }

    }


    /*
     * ----------------------------------------
     * OPPORTUNITY REALLY DOES NOT EXIST
     * ----------------------------------------
     */

   const crm =
  resolveCRMAdapter(
    context.tenant,
  );


const created =
  await crm.createOpportunity(
    context,
    opportunity,
  );


await repositories
  .reservationLinkRepository
  .updateCrmIdentity(
    context.tenant.id,

    opportunity.reservationId,

    opportunity.contactId,

    created.id,
  );


/*
 * ----------------------------------------
 * RESTORE CURRENT RESERVATION LIFECYCLE
 * ----------------------------------------
 *
 * A replacement opportunity is initially
 * created using the payload's default/current
 * opportunity stage.
 *
 * The reservation may already be:
 *
 *   reserved
 *   checked_in
 *   checked_out
 *   cancelled
 *
 * Restore the opportunity to the lifecycle
 * currently owned by Core.
 */

const stage =
  resolveReservationStage(
    lifecycle,
  );


const crmConfiguration =
  context.tenant
    .integrations
    .crm
    .configuration;


if (
  !crmConfiguration
) {

  throw new Error(
    "CRM integration has not been configured.",
  );

}


const workflowState =
  crmConfiguration
    .workflow
    .states
    .find(
      (state) =>
        state.key ===
        stage,
    );


if (
  !workflowState
) {

  throw new Error(
    `Workflow stage '${stage}' for lifecycle '${lifecycle}' is not configured.`,
  );

}


await crm.moveOpportunity(
  context,
  created.id,
  workflowState.providerStateId,
);


return created.id;

  }


  async synchronize(
    db:
      D1Database,

    context:
      RequestContext,

    opportunity:
      ReservationOpportunity,
  ) {


    const repositories =
      createRepositories(
        db,
      );


    const reservationLink =
      await repositories
        .reservationLinkRepository
        .find(
          context.tenant.id,
          opportunity.reservationId,
        );


    const crm =
      resolveCRMAdapter(
        context.tenant,
      );


    const lifecycle =
      resolveReservationLifecycle(
        opportunity,
      );


    // ==========================================================
    // First Reservation
    //
    // No reservation link exists.
    //
    // CRM creates the opportunity first, then the reservation
    // link is created with the CRM identity attached.
    // ==========================================================

    if (
      !reservationLink
    ) {


      const opportunityId =
        await createReservationOpportunity(
          db,
          context,
          crm,
          opportunity,
          lifecycle,
        );


      const createdEvent:
        ReservationEvent = {

        type:
          "reservation.created",

        tenantId:
          context.tenant.id,

        reservationId:
          opportunity.reservationId,

        contactId:
          opportunity.contactId,

        opportunityId,

        occurredAt:
          new Date(),

      };


      await dispatchReservationEvent(
        createdEvent,
      );


      return {

        id:
          opportunityId,

        action:
          "created",

      };

    }


    // ==========================================================
    // Core-created reservation without CRM opportunity
    //
    // Core may establish the reservation/provider identity
    // before CRM reconciliation.
    //
    // In that case, create the CRM opportunity now and attach
    // it to the EXISTING reservation link.
    //
    // Do NOT call reservationLinkRepository.create().
    // ==========================================================

    if (
      !reservationLink.opportunityId
    ) {


      const created =
        await crm.createOpportunity(
          context,
          opportunity,
        );


      await attachReservationOpportunity(
        db,
        context,
        opportunity,
        created.id,
      );


      const createdEvent:
        ReservationEvent = {

        type:
          "reservation.created",

        tenantId:
          context.tenant.id,

        reservationId:
          opportunity.reservationId,

        contactId:
          opportunity.contactId,

        opportunityId:
          created.id,

        occurredAt:
          new Date(),

      };


      await dispatchReservationEvent(
        createdEvent,
      );


      return {

        id:
          created.id,

        action:
          "created",

      };

    }


// ==========================================================
// No Lifecycle Change
// ==========================================================

if (
  !shouldMoveOpportunity(
    reservationLink.lifecycle,
    lifecycle,
  )
) {

  /*
   * Lifecycle is unchanged, but the reservation
   * data may have changed.
   *
   * Update the EXISTING GHL opportunity.
   *
   * If Core's stored opportunityId is stale,
   * recover it and retry exactly once.
   */

  let opportunityId =
    reservationLink.opportunityId;


  try {

    await crm.updateOpportunity(
      context,
      opportunityId,
      opportunity,
    );

    } catch (error) {

    if (
      !(
        error instanceof ApiError &&
        error.status === 404
      )
    ) {

      throw error;

    }


    opportunityId =
      await this.recoverOpportunityId(
        db,
        context,
        opportunity,
        reservationLink.lifecycle,
      );


    await crm.updateOpportunity(
      context,
      opportunityId,
      opportunity,
    );

  }


  return {

    id:
      opportunityId,

    action:
      "updated",

  };

}


    // ==========================================================
    // Resolve Workflow Stage
    // ==========================================================

    const stage =
      resolveReservationStage(
        lifecycle,
      );


    const crmConfiguration =
      context.tenant
        .integrations
        .crm
        .configuration;


    if (
      !crmConfiguration
    ) {

      throw new Error(
        "CRM integration has not been configured.",
      );

    }


    const workflowState =
      crmConfiguration
        .workflow
        .states
        .find(
          (state) =>
            state.key ===
            stage,
        );


    if (
      !workflowState
    ) {

      throw new Error(
        `Workflow stage '${stage}' for lifecycle '${lifecycle}' is not configured.`,
      );

    }


    // ==========================================================
    // Move Opportunity
    //
    // At this point opportunityId is guaranteed to exist.
    // ==========================================================

        let opportunityId =
      reservationLink.opportunityId;


    try {

      await moveReservationOpportunity(
        db,
        context,
        crm,

        opportunityId,

        opportunity.reservationId,

        lifecycle,

        workflowState.providerStateId,
      );

      } catch (error) {

      if (
        !(
          error instanceof ApiError &&
          error.status === 404
        )
      ) {

        throw error;

      }


      opportunityId =
        await this.recoverOpportunityId(
          db,
          context,
          opportunity,
          lifecycle,
        );


      await moveReservationOpportunity(
        db,
        context,
        crm,

        opportunityId,

        opportunity.reservationId,

        lifecycle,

        workflowState.providerStateId,
      );

    }


    return {

      id:
        opportunityId,

      action:
        "moved",

    };

  }

}


export const reservationLifecycleService =
  new ReservationLifecycleService();
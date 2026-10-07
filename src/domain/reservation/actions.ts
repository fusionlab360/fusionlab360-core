import type {
  RequestContext,
} from "../../context";


import {
  createRepositories,
} from "../../persistence/factory";


import type {
  CRMAdapter,
} from "../../core/crm/contracts";


import type {
  ReservationOpportunity,
} from "./opportunity";


import type {
  ReservationLifecycle,
} from "./lifecycle";


export async function createReservationOpportunity(
  db:
    D1Database,

  context:
    RequestContext,

  crm:
    CRMAdapter,

  opportunity:
    ReservationOpportunity,

  lifecycle:
    ReservationLifecycle,
) {

  const repositories =
    createRepositories(
      db,
    );


  const created =
    await crm.createOpportunity(
      context,
      opportunity,
    );


  // ------------------------------------------------------------
  // This is the original path.
  //
  // It is only used when no reservation link exists yet.
  // ------------------------------------------------------------

  await repositories
    .reservationLinkRepository
    .create({

      tenantId:
        context.tenant.id,

      reservationId:
        opportunity.reservationId,

      contactId:
        opportunity.contactId,

      opportunityId:
        created.id,

      lifecycle,

      createdAt:
        new Date(),

      updatedAt:
        new Date(),

    });


  return created.id;

}


/**
 * Attach a newly-created CRM opportunity to an existing
 * Core reservation link.
 *
 * This is used when the Core PMS orchestration path has already
 * established the reservation/provider identity.
 */
export async function attachReservationOpportunity(
  db:
    D1Database,

  context:
    RequestContext,

  opportunity:
    ReservationOpportunity,

  opportunityId:
    string,
) {

  const repositories =
    createRepositories(
      db,
    );


  await repositories
    .reservationLinkRepository
    .updateCrmIdentity(

      context.tenant.id,

      opportunity.reservationId,

      opportunity.contactId,

      opportunityId,

    );


  return opportunityId;

}


export async function moveReservationOpportunity(
  db:
    D1Database,

  context:
    RequestContext,

  crm:
    CRMAdapter,

  opportunityId:
    string,

  reservationId:
    string,

  lifecycle:
    ReservationLifecycle,

  providerStageId:
    string,
) {

  const repositories =
    createRepositories(
      db,
    );


  await crm.moveOpportunity(
    context,
    opportunityId,
    providerStageId,
  );


  await repositories
    .reservationLinkRepository
    .updateLifecycle(
      context.tenant.id,
      reservationId,
      lifecycle,
    );

}
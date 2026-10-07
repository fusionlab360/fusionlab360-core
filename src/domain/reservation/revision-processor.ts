import type {
  ReservationLink,
} from "../../persistence/models/reservation-link";

import {
  createRepositories,
} from "../../persistence/factory";

import {
  evaluateReservationRevision,
} from "./revision-service";


export interface ReservationRevisionProcessorResult {

  accepted: boolean;

  stale: boolean;

  same: boolean;

  storedRevision: number;

  incomingRevision: number;

}


export function evaluateRevisionForProcessing(
  reservation:
    ReservationLink,
  incomingRevision:
    number,
): ReservationRevisionProcessorResult {

  const result =
    evaluateReservationRevision(
      reservation,
      incomingRevision,
    );


  return {

    accepted:
      result.decision ===
        "accept",

    stale:
      result.decision ===
        "stale",

    same:
      result.decision ===
        "same",

    storedRevision:
      result.storedRevision,

    incomingRevision:
      result.incomingRevision,

  };

}


/**
 * Atomically accepts a newer reservation revision.
 *
 * This performs two stages:
 *
 * 1. Evaluate the incoming revision against
 *    the currently known reservation revision.
 *
 * 2. If the revision is newer, atomically
 *    advance the stored revision.
 *
 * Only the request that successfully advances
 * the database revision is allowed to continue.
 */
export async function acceptReservationRevision(
  db: D1Database,
  reservation:
    ReservationLink,
  incomingRevision:
    number,
): Promise<ReservationRevisionProcessorResult> {

  const decision =
    evaluateRevisionForProcessing(
      reservation,
      incomingRevision,
    );


  // ------------------------------------------------------------
  // Older revision
  // ------------------------------------------------------------

  if (
    decision.stale
  ) {

    return {

      accepted:
        false,

      stale:
        true,

      same:
        false,

      storedRevision:
        decision.storedRevision,

      incomingRevision,

    };

  }


  // ------------------------------------------------------------
  // Same revision
  //
  // Do not advance the stored revision.
  //
  // Event-level idempotency is handled separately.
  // ------------------------------------------------------------

  if (
    decision.same
  ) {

    return {

      accepted:
        false,

      stale:
        false,

      same:
        true,

      storedRevision:
        decision.storedRevision,

      incomingRevision,

    };

  }


  // ------------------------------------------------------------
  // Newer revision
  //
  // Perform the atomic database acceptance.
  // ------------------------------------------------------------

  const repositories =
    createRepositories(
      db,
    );


  const accepted =
    await repositories
      .reservationLinkRepository
      .acceptRevision(
        reservation.tenantId,
        reservation.reservationId,
        incomingRevision,
      );


  return {

    accepted,

    stale:
      false,

    same:
      false,

    storedRevision:
      decision.storedRevision,

    incomingRevision,

  };

}
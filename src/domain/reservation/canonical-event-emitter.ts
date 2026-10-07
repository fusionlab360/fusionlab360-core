import type {
  PMSEvent,
} from "../../core/pms/models/reservation-event";

import type {
  IntegrationEvent,
} from "../../core/events/types";

import type {
  ReservationOrchestrationResult,
} from "./orchestrator";

import type {
  ReservationLifecycleEventPayload,
} from "./lifecycle-event-payload";

import type {
  ReservationUpdateEventPayload,
} from "./update-event-payload";

import type {
  CanonicalReservationEventPayload,
} from "./canonical-event-payload";

import {
  CanonicalReservationEventType,
} from "./canonical-events";


/**
 * Build a provider-neutral IntegrationEvent from
 * the already-normalized PMS event and the result
 * of reservation orchestration.
 *
 * Important:
 *
 * - tenantId comes from RequestContext, not PMSEvent.
 * - PMSEvent.eventType is already canonical.
 * - duplicate/stale/unresolved results do not emit events.
 * - this function does not persist the event.
 */
export function buildReservationIntegrationEvent(
  result:
    ReservationOrchestrationResult,

  event:
    PMSEvent,

  tenantId:
    string,

  eventId:
    string,
):
  IntegrationEvent {


  // ------------------------------------------------------------
  // CREATE
  // ------------------------------------------------------------

  if (
    result.action ===
    "create"
  ) {

    const payload:
      CanonicalReservationEventPayload = {

      reservation:
        event.reservation,

    };

    return {

      eventId,

      eventType:
        CanonicalReservationEventType.CREATED,

      aggregateType:
        "reservation",

      aggregateId:
        result.canonicalReservationId,

      tenantId,

      provider:
        event.provider,

      occurredAt:
        event.occurredAt,

      revision:
        result.revision,

      payload,

    };

  }


  // ------------------------------------------------------------
  // ORDINARY RESERVATION UPDATE
  // ------------------------------------------------------------

  if (
    result.action ===
    "update"
  ) {

    const payload:
      ReservationUpdateEventPayload = {

      reservation:
        event.reservation,

      changedFields: [],

    };

    return {

      eventId,

      eventType:
        CanonicalReservationEventType.UPDATED,

      aggregateType:
        "reservation",

      aggregateId:
        result.canonicalReservationId,

      tenantId,

      provider:
        event.provider,

      occurredAt:
        event.occurredAt,

      revision:
        result.revision,

      payload,

    };

  }


  // ------------------------------------------------------------
  // LIFECYCLE TRANSITION
  // ------------------------------------------------------------

  if (
    result.action ===
    "lifecycle"
  ) {

    const lifecycle =
      result.lifecycle;

    if (
      lifecycle !==
        "checked_in" &&
      lifecycle !==
        "checked_out" &&
      lifecycle !==
        "cancelled"
    ) {

      throw new Error(
        `Lifecycle '${lifecycle}' cannot be emitted as a canonical reservation lifecycle event.`,
      );

    }

    const payload:
      ReservationLifecycleEventPayload = {

      reservation:
        event.reservation,

      lifecycle,

    };

    return {

      eventId,

      eventType:
        event.eventType,

      aggregateType:
        "reservation",

      aggregateId:
        result.canonicalReservationId,

      tenantId,

      provider:
        event.provider,

      occurredAt:
        event.occurredAt,

      revision:
        result.revision,

      payload,

    };

  }


  // ------------------------------------------------------------
  // Non-emitting orchestration outcomes
  // ------------------------------------------------------------
  //
  // duplicate
  // stale
  // unresolved
  //
  // These are intentionally NOT converted into
  // reservation integration events.
  // ------------------------------------------------------------

  throw new Error(
    `Reservation action '${result.action}' does not produce a canonical integration event.`,
  );

}

export function createReservationEventId(
  canonicalReservationId: string,
  eventType: string,
  revision?: number,
): string {

  return [
    "reservation",
    canonicalReservationId,
    eventType,
    revision ??
      "none",
  ].join(":");

}
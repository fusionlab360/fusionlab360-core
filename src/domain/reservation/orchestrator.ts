import type {
  RequestContext,
} from "../../context";

import type {
  PMSEvent,
} from "../../core/pms/models/reservation-event";

import {
  createCanonicalReservationId,
} from "../../canonical/reservation";

import {
  createRepositories,
} from "../../persistence/factory";

import {
  evaluateReservationTransition,
} from "./transition-evaluator";

import type {
  ReservationLifecycle,
} from "./lifecycle";

import {
  ReservationIdentityService,
} from "./identity-service";

import {
  acceptReservationRevision,
} from "./revision-processor";

import {
  IntegrationEventService,
} from "../../core/events/service";

import {
  buildReservationIntegrationEvent,
  createReservationEventId,
} from "./canonical-event-emitter";

import type {
  ReservationRecord,
} from "../../persistence/models/reservation-record";


export type ReservationOrchestrationAction =
  | "create"
  | "update"
  | "lifecycle"
  | "duplicate"
  | "stale"
  | "unresolved";


export interface ReservationOrchestrationResult {

  action:
    ReservationOrchestrationAction;

  canonicalReservationId:
    string;

  reservationId:
    string;

  lifecycle?:
    ReservationLifecycle;

  provider:
    string;

  providerReservationId:
    string;

  providerCalendarId?:
    string;

  providerEditId?:
    string;

  revision?:
    number;

}


export class ReservationOrchestrator {


  // ============================================================
  // Persist canonical reservation state.
  // ============================================================

  private async persistCanonicalReservation(
    db:
      D1Database,

    context:
      RequestContext,

    event:
      PMSEvent,

    canonicalReservationId:
      string,

    lifecycle:
      ReservationLifecycle,

    revision:
      number,
  ):
    Promise<void> {

    const repositories =
      createRepositories(
        db,
      );

    const now =
      new Date().toISOString();

    const record:
      ReservationRecord = {

      tenantId:
        context.tenant.id,

      canonicalReservationId,

      provider:
        event.providerIdentity.provider,

      providerReservationId:
        event.providerIdentity
          .providerReservationId,

      providerCalendarId:
        event.providerIdentity
          .providerCalendarId,

      providerEditId:
        event.providerIdentity
          .providerEditId,

      revision,

      lifecycle,

      payload:
        JSON.stringify(
          event.reservation,
        ),

      createdAt:
        now,

      updatedAt:
        now,

    };

    await repositories
      .reservationRecordRepository
      .upsert(
        record,
      );

  }


  // ============================================================
  // Emit canonical IntegrationEvent.
  // ============================================================

  private async emitReservationEvent(
    eventService:
      IntegrationEventService,

    context:
      RequestContext,

    event:
      PMSEvent,

    result:
      ReservationOrchestrationResult,
  ):
    Promise<void> {

    if (
      result.action !==
        "create" &&

      result.action !==
        "update" &&

      result.action !==
        "lifecycle"
    ) {

      return;

    }

    const eventType =
      result.action ===
        "create"

        ? "reservation.created"

        : result.action ===
            "update"

          ? "reservation.updated"

          : event.eventType;

    const eventId =
      createReservationEventId(
        result.canonicalReservationId,
        eventType,
        result.revision,
      );

    const integrationEvent =
      buildReservationIntegrationEvent(
        result,
        event,
        context.tenant.id,
        eventId,
      );

    await eventService.accept(
      integrationEvent,
    );

  }


  // ============================================================
  // Reservation orchestration.
  // ============================================================

  async evaluate(
    db:
      D1Database,

    context:
      RequestContext,

    event:
      PMSEvent,
  ):
    Promise<
      ReservationOrchestrationResult
    > {

    const repositories =
      createRepositories(
        db,
      );

    const eventService =
      new IntegrationEventService(
        repositories
          .integrationEventRepository,
      );

    const providerIdentity =
      event.providerIdentity;


    // ============================================================
    // 1. Resolve existing reservation.
    //
    // Local reservation identity is checked first because the
    // production CRM path may already have created reservation_links.
    // ============================================================

    const localExistingCandidate =
      await repositories
        .reservationLinkRepository
        .find(
          context.tenant.id,
          event.reservation.reservationId,
        );

    const localExisting =
      localExistingCandidate &&
      localExistingCandidate.lifecycle !==
        "cancelled"
        ? localExistingCandidate
        : null;

    const localCancelled =
      localExistingCandidate &&
      localExistingCandidate.lifecycle ===
        "cancelled"
        ? localExistingCandidate
        : null;


    const providerExistingCandidate =
      localExisting
        ? null
        : await repositories
            .reservationLinkRepository
            .findByProviderReservationId(
              context.tenant.id,
              providerIdentity.provider,
              providerIdentity.providerReservationId,
            );

    const providerExisting =
      providerExistingCandidate &&
      providerExistingCandidate.lifecycle !==
        "cancelled"
        ? providerExistingCandidate
        : null;

    const providerCancelled =
      providerExistingCandidate &&
      providerExistingCandidate.lifecycle ===
        "cancelled"
        ? providerExistingCandidate
        : null;


    const existing =
      localExisting ??
      providerExisting;

    const cancelledHistorical =
      localCancelled ??
      providerCancelled;


    // ============================================================
    // 2. Revision gate.
    // ============================================================

    if (
      existing &&
      event.revision !== undefined
    ) {

      const revisionResult =
        await acceptReservationRevision(
          db,
          existing,
          event.revision,
        );


      if (
        revisionResult.stale
      ) {

        return {

          action:
            "stale",

          canonicalReservationId:
            existing.canonicalReservationId ??
            "",

          reservationId:
            existing.reservationId,

          lifecycle:
            event.lifecycle,

          provider:
            providerIdentity.provider,

          providerReservationId:
            providerIdentity.providerReservationId,

          providerCalendarId:
            providerIdentity.providerCalendarId,

          providerEditId:
            providerIdentity.providerEditId,

          revision:
            event.revision,

        };

      }


      if (
        revisionResult.same
      ) {

        return {

          action:
            "duplicate",

          canonicalReservationId:
            existing.canonicalReservationId ??
            "",

          reservationId:
            existing.reservationId,

          lifecycle:
            event.lifecycle,

          provider:
            providerIdentity.provider,

          providerReservationId:
            providerIdentity.providerReservationId,

          providerCalendarId:
            providerIdentity.providerCalendarId,

          providerEditId:
            providerIdentity.providerEditId,

          revision:
            event.revision,

        };

      }

    }

    // ============================================================
    // 3. Recycle historical cancelled reservation
    //
    // A cancelled reservation is historical state.
    // It must not donate its old GHL contact/opportunity
    // to a new active reservation instance.
    //
    // Reuse the existing reservation_links row because
    // reservation_id remains the local primary identity.
    // ============================================================

    if (
      cancelledHistorical
    ) {

      const canonicalReservationId =
        createCanonicalReservationId();

      const lifecycle =
        event.lifecycle ??
        "new_booking";

      const revision =
        event.revision ??
        0;


      await this.persistCanonicalReservation(
        db,
        context,
        event,
        canonicalReservationId,
        lifecycle,
        revision,
      );


      await repositories
        .reservationLinkRepository
        .recycleCancelledReservation(
          context.tenant.id,

          cancelledHistorical.reservationId,

          canonicalReservationId,

          providerIdentity.provider,

          providerIdentity.providerReservationId,

          providerIdentity.providerCalendarId ??
            null,

          providerIdentity.providerEditId ??
            null,

          revision,

          lifecycle,
        );


      const result:
        ReservationOrchestrationResult = {

        action:
          "create",

        canonicalReservationId,

        reservationId:
          cancelledHistorical.reservationId,

        lifecycle,

        provider:
          providerIdentity.provider,

        providerReservationId:
          providerIdentity.providerReservationId,

        providerCalendarId:
          providerIdentity.providerCalendarId,

        providerEditId:
          providerIdentity.providerEditId,

        revision,

      };


      await this.emitReservationEvent(
        eventService,
        context,
        event,
        result,
      );


      return result;
    }
    
    // ============================================================
    // 3. Provider identity reconciliation.
    // ============================================================

    const identityService =
      new ReservationIdentityService();

    const identityResult =
      await identityService.reconcile(
        db,
        context.tenant.id,
        providerIdentity,
      );


    // ============================================================
    // 4. CRM-first existing link without canonical identity.
    //
    // Existing CRM row is enriched rather than inserted again.
    // ============================================================

    if (
      existing &&
      !existing.canonicalReservationId
    ) {

      const canonicalReservationId =
        identityResult.canonicalReservationId ??
        createCanonicalReservationId();

      const lifecycle =
        event.lifecycle ??
        existing.lifecycle ??
        "new_booking";

      const revision =
        event.revision ??
        existing.revision ??
        0;


      await this.persistCanonicalReservation(
        db,
        context,
        event,
        canonicalReservationId,
        lifecycle,
        revision,
      );


      await repositories
        .reservationLinkRepository
        .updateProviderIdentity(
          context.tenant.id,
          existing.reservationId,
          canonicalReservationId,
          providerIdentity.provider,
          providerIdentity.providerReservationId,
          providerIdentity.providerCalendarId ??
            null,
          providerIdentity.providerEditId ??
            null,
        );


      const result:
        ReservationOrchestrationResult = {

        action:
          "create",

        canonicalReservationId,

        reservationId:
          existing.reservationId,

        lifecycle,

        provider:
          providerIdentity.provider,

        providerReservationId:
          providerIdentity.providerReservationId,

        providerCalendarId:
          providerIdentity.providerCalendarId,

        providerEditId:
          providerIdentity.providerEditId,

        revision,

      };


      await this.emitReservationEvent(
        eventService,
        context,
        event,
        result,
      );


      return result;

    }


    // ============================================================
    // 5. Completely new PMS/Core reservation.
    // ============================================================

    if (
      !existing
    ) {

      const canonicalReservationId =
        identityResult.canonicalReservationId ??
        createCanonicalReservationId();

      const lifecycle =
        event.lifecycle ??
        "new_booking";

      const revision =
        event.revision ??
        0;


      await this.persistCanonicalReservation(
        db,
        context,
        event,
        canonicalReservationId,
        lifecycle,
        revision,
      );


      await repositories
        .reservationLinkRepository
        .create({

          tenantId:
            context.tenant.id,

          reservationId:
            event.reservation.reservationId,

          canonicalReservationId,

          provider:
            providerIdentity.provider,

          providerReservationId:
            providerIdentity.providerReservationId,

          providerCalendarId:
            providerIdentity.providerCalendarId,

          providerEditId:
            providerIdentity.providerEditId,

          revision,

          lastEventId:
            undefined,

          contactId:
            null,

          opportunityId:
            null,

          lifecycle,

          createdAt:
            new Date(),

          updatedAt:
            new Date(),

        });


      const result:
        ReservationOrchestrationResult = {

        action:
          "create",

        canonicalReservationId,

        reservationId:
          event.reservation.reservationId,

        lifecycle,

        provider:
          providerIdentity.provider,

        providerReservationId:
          providerIdentity.providerReservationId,

        providerCalendarId:
          providerIdentity.providerCalendarId,

        providerEditId:
          providerIdentity.providerEditId,

        revision,

      };


      await this.emitReservationEvent(
        eventService,
        context,
        event,
        result,
      );


      return result;

    }


    // ============================================================
    // 6. Existing canonical reservation.
    //
    // IMPORTANT:
    //
    // reservation_links.lifecycle may have already been changed
    // by the legacy CRM lifecycle path.
    //
    // Therefore it must NOT be used as the canonical previous
    // lifecycle.
    //
    // reservation_records.lifecycle is the Core source of truth.
    // ============================================================

    const canonicalReservationId =
      identityResult.canonicalReservationId ??
      existing.canonicalReservationId ??
      createCanonicalReservationId();


    const canonicalRecord =
      existing.canonicalReservationId

        ? await repositories
            .reservationRecordRepository
            .find(
              context.tenant.id,
              existing.canonicalReservationId,
            )

        : null;


    const currentLifecycle =
      (
        canonicalRecord?.lifecycle ??
        existing.lifecycle
      ) as ReservationLifecycle;


    const incomingLifecycle =
      event.lifecycle ??
      currentLifecycle;


    const revision =
      event.revision ??
      canonicalRecord?.revision ??
      existing.revision ??
      0;


    // ------------------------------------------------------------
    // Keep provider identity synchronized.
    // ------------------------------------------------------------

    await repositories
      .reservationLinkRepository
      .updateProviderIdentity(
        context.tenant.id,
        existing.reservationId,
        canonicalReservationId,
        providerIdentity.provider,
        providerIdentity.providerReservationId,
        providerIdentity.providerCalendarId ??
          null,
        providerIdentity.providerEditId ??
          null,
      );


    // ============================================================
    // 7. Evaluate lifecycle using CANONICAL previous state.
    // ============================================================

    if (
      event.lifecycle
    ) {

      const transition =
        evaluateReservationTransition(
          currentLifecycle,
          event.lifecycle,
        );


      if (
        transition.validity ===
          "invalid"
      ) {

        return {

          action:
            "unresolved",

          canonicalReservationId,

          reservationId:
            existing.reservationId,

          lifecycle:
            event.lifecycle,

          provider:
            providerIdentity.provider,

          providerReservationId:
            providerIdentity.providerReservationId,

          providerCalendarId:
            providerIdentity.providerCalendarId,

          providerEditId:
            providerIdentity.providerEditId,

          revision,

        };

      }


      if (
        transition.changed &&
        transition.transition !==
          "none"
      ) {

        await this.persistCanonicalReservation(
          db,
          context,
          event,
          canonicalReservationId,
          event.lifecycle,
          revision,
        );


        await repositories
          .reservationLinkRepository
          .updateLifecycle(
            context.tenant.id,
            existing.reservationId,
            event.lifecycle,
          );


        const result:
          ReservationOrchestrationResult = {

          action:
            "lifecycle",

          canonicalReservationId,

          reservationId:
            existing.reservationId,

          lifecycle:
            event.lifecycle,

          provider:
            providerIdentity.provider,

          providerReservationId:
            providerIdentity.providerReservationId,

          providerCalendarId:
            providerIdentity.providerCalendarId,

          providerEditId:
            providerIdentity.providerEditId,

          revision,

        };


        await this.emitReservationEvent(
          eventService,
          context,
          event,
          result,
        );


        return result;

      }

    }


    // ============================================================
    // 8. Existing canonical reservation with no operational
    // lifecycle change.
    // ============================================================

    await this.persistCanonicalReservation(
      db,
      context,
      event,
      canonicalReservationId,
      incomingLifecycle,
      revision,
    );


    const result:
      ReservationOrchestrationResult = {

      action:
        "update",

      canonicalReservationId,

      reservationId:
        existing.reservationId,

      lifecycle:
        incomingLifecycle,

      provider:
        providerIdentity.provider,

      providerReservationId:
        providerIdentity.providerReservationId,

      providerCalendarId:
        providerIdentity.providerCalendarId,

      providerEditId:
        providerIdentity.providerEditId,

      revision,

    };


    await this.emitReservationEvent(
      eventService,
      context,
      event,
      result,
    );


    return result;

  }

}
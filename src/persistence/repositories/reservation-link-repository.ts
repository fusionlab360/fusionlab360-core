import {
  BaseRepository,
} from "./base-repository";

import type {
  ReservationLink,
} from "../models/reservation-link";

import type {
  ReservationLifecycle,
} from "../../domain/reservation/lifecycle";


export class ReservationLinkRepository
  extends BaseRepository {


  // ============================================================
  // Find reservation by local reservation identity
  // ============================================================

  async find(
    tenantId:
      string,

    reservationId:
      string,
  ):
    Promise<
      ReservationLink | null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_links
          WHERE tenant_id = ?
            AND reservation_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          reservationId,
        )
        .first<any>();


    if (!result) {

      return null;

    }


    return {

      tenantId:
        result.tenant_id,

      reservationId:
        result.reservation_id,

      canonicalReservationId:
        result.canonical_reservation_id ??
        undefined,

      provider:
        result.provider ??
        undefined,

      providerReservationId:
        result.provider_reservation_id ??
        undefined,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision ??
        undefined,

      lastEventId:
        result.last_event_id ??
        undefined,

      contactId:
        result.contact_id ??
        undefined,

      opportunityId:
        result.opportunity_id ??
        undefined,

      lifecycle:
        result.lifecycle,

      createdAt:
        new Date(
          result.created_at,
        ),

      updatedAt:
        new Date(
          result.updated_at,
        ),

    };

  }


  // ============================================================
  // Find by canonical FusionLab360 reservation identity
  // ============================================================

  async findByCanonicalReservationId(
    tenantId:
      string,

    canonicalReservationId:
      string,
  ):
    Promise<
      ReservationLink | null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_links
          WHERE tenant_id = ?
            AND canonical_reservation_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          canonicalReservationId,
        )
        .first<{

          tenant_id:
            string;

          reservation_id:
            string;

          canonical_reservation_id:
            string | null;

          provider:
            string | null;

          provider_reservation_id:
            string | null;

          provider_calendar_id:
            string | null;

          provider_edit_id:
            string | null;

          revision:
            number | null;

          last_event_id:
            string | null;

          contact_id:
            string | null;

          opportunity_id:
            string | null;

          lifecycle:
            ReservationLifecycle;

          created_at:
            string;

          updated_at:
            string;

        }>();


    if (!result) {

      return null;

    }


    return {

      tenantId:
        result.tenant_id,

      reservationId:
        result.reservation_id,

      canonicalReservationId:
        result.canonical_reservation_id ??
        undefined,

      provider:
        result.provider ??
        undefined,

      providerReservationId:
        result.provider_reservation_id ??
        undefined,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision ??
        undefined,

      lastEventId:
        result.last_event_id ??
        undefined,

      contactId:
        result.contact_id ??
        undefined,

      opportunityId:
        result.opportunity_id ??
        undefined,

      lifecycle:
        result.lifecycle,

      createdAt:
        new Date(
          result.created_at,
        ),

      updatedAt:
        new Date(
          result.updated_at,
        ),

    };

  }


  // ============================================================
  // Find by provider reservation identity
  // ============================================================

  async findByProviderReservationId(
    tenantId:
      string,

    provider:
      string,

    providerReservationId:
      string,
  ):
    Promise<
      ReservationLink | null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_links
          WHERE tenant_id = ?
            AND provider = ?
            AND provider_reservation_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          providerReservationId,
        )
        .first<{

          tenant_id:
            string;

          reservation_id:
            string;

          canonical_reservation_id:
            string | null;

          provider:
            string | null;

          provider_reservation_id:
            string | null;

          provider_calendar_id:
            string | null;

          provider_edit_id:
            string | null;

          revision:
            number | null;

          last_event_id:
            string | null;

          contact_id:
            string | null;

          opportunity_id:
            string | null;

          lifecycle:
            ReservationLifecycle;

          created_at:
            string;

          updated_at:
            string;

        }>();


    if (!result) {

      return null;

    }


    return {

      tenantId:
        result.tenant_id,

      reservationId:
        result.reservation_id,

      canonicalReservationId:
        result.canonical_reservation_id ??
        undefined,

      provider:
        result.provider ??
        undefined,

      providerReservationId:
        result.provider_reservation_id ??
        undefined,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision ??
        undefined,

      lastEventId:
        result.last_event_id ??
        undefined,

      contactId:
        result.contact_id ??
        undefined,

      opportunityId:
        result.opportunity_id ??
        undefined,

      lifecycle:
        result.lifecycle,

      createdAt:
        new Date(
          result.created_at,
        ),

      updatedAt:
        new Date(
          result.updated_at,
        ),

    };

  }


  // ============================================================
  // Find by provider calendar identity
  // ============================================================

  async findByProviderCalendarId(
    tenantId:
      string,

    provider:
      string,

    providerCalendarId:
      string,
  ):
    Promise<
      ReservationLink | null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_links
          WHERE tenant_id = ?
            AND provider = ?
            AND provider_calendar_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          provider,
          providerCalendarId,
        )
        .first<{

          tenant_id:
            string;

          reservation_id:
            string;

          canonical_reservation_id:
            string | null;

          provider:
            string | null;

          provider_reservation_id:
            string | null;

          provider_calendar_id:
            string | null;

          provider_edit_id:
            string | null;

          revision:
            number | null;

          last_event_id:
            string | null;

          contact_id:
            string | null;

          opportunity_id:
            string | null;

          lifecycle:
            ReservationLifecycle;

          created_at:
            string;

          updated_at:
            string;

        }>();


    if (!result) {

      return null;

    }


    return {

      tenantId:
        result.tenant_id,

      reservationId:
        result.reservation_id,

      canonicalReservationId:
        result.canonical_reservation_id ??
        undefined,

      provider:
        result.provider ??
        undefined,

      providerReservationId:
        result.provider_reservation_id ??
        undefined,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision ??
        undefined,

      lastEventId:
        result.last_event_id ??
        undefined,

      contactId:
        result.contact_id ??
        undefined,

      opportunityId:
        result.opportunity_id ??
        undefined,

      lifecycle:
        result.lifecycle,

      createdAt:
        new Date(
          result.created_at,
        ),

      updatedAt:
        new Date(
          result.updated_at,
        ),

    };

  }

    // ============================================================
  // Find reservation by CRM opportunity identity
  //
  // An opportunity may belong to only one reservation
  // within the same tenant.
  // ============================================================

  async findByOpportunityId(
    tenantId:
      string,

    opportunityId:
      string,
  ):
    Promise<
      ReservationLink | null
    > {

    const result =
      await this.db
        .prepare(
          `
          SELECT *
          FROM reservation_links
          WHERE tenant_id = ?
            AND opportunity_id = ?
          LIMIT 1
          `,
        )
        .bind(
          tenantId,
          opportunityId,
        )
        .first<any>();


    if (!result) {

      return null;

    }


    return {

      tenantId:
        result.tenant_id,

      reservationId:
        result.reservation_id,

      canonicalReservationId:
        result.canonical_reservation_id ??
        undefined,

      provider:
        result.provider ??
        undefined,

      providerReservationId:
        result.provider_reservation_id ??
        undefined,

      providerCalendarId:
        result.provider_calendar_id ??
        undefined,

      providerEditId:
        result.provider_edit_id ??
        undefined,

      revision:
        result.revision ??
        undefined,

      lastEventId:
        result.last_event_id ??
        undefined,

      contactId:
        result.contact_id ??
        undefined,

      opportunityId:
        result.opportunity_id ??
        undefined,

      lifecycle:
        result.lifecycle,

      createdAt:
        new Date(
          result.created_at,
        ),

      updatedAt:
        new Date(
          result.updated_at,
        ),

    };

  }




  // ============================================================
  // Create reservation link
  //
  // CRM identity is intentionally optional.
  //
  // Core can establish provider reservation identity before
  // contact/opportunity reconciliation.
  // ============================================================

    async create(
    link:
      ReservationLink,
  ):
    Promise<void> {

    /*
     * ------------------------------------------------------------
     * CRM OPPORTUNITY OWNERSHIP GUARD
     * ------------------------------------------------------------
     *
     * A single GHL opportunity must never be attached to
     * multiple Core reservations.
     *
     * This is intentionally enforced at the repository boundary
     * so every existing reservation pipeline receives the same
     * protection.
     */

    if (
      link.opportunityId
    ) {

      const existingOwner =
        await this.findByOpportunityId(
          link.tenantId,
          link.opportunityId,
        );


      if (
        existingOwner &&
        existingOwner.reservationId !==
          link.reservationId
      ) {

        throw new Error(
          `CRM opportunity '${link.opportunityId}' is already linked to reservation '${existingOwner.reservationId}'. Cannot attach it to reservation '${link.reservationId}'.`,
        );

      }

    }


    await this.db
      .prepare(
        `
        INSERT INTO reservation_links (

          tenant_id,
          reservation_id,

          canonical_reservation_id,
          provider,
          provider_reservation_id,
          provider_calendar_id,
          provider_edit_id,
          revision,
          last_event_id,

          contact_id,
          opportunity_id,
          lifecycle

        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(

        link.tenantId,

        link.reservationId,

        link.canonicalReservationId ??
          null,

        link.provider ??
          null,

        link.providerReservationId ??
          null,

        link.providerCalendarId ??
          null,

        link.providerEditId ??
          null,

        link.revision ??
          0,

        link.lastEventId ??
          null,

        link.contactId ??
          null,

        link.opportunityId ??
          null,

        link.lifecycle,

      )
      .run();

  }



  // ============================================================
  // Update provider identity
  // ============================================================

  async updateProviderIdentity(
    tenantId:
      string,

    reservationId:
      string,

    canonicalReservationId:
      string,

    provider:
      string,

    providerReservationId:
      string,

    providerCalendarId:
      string | null,

    providerEditId:
      string | null,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE reservation_links
        SET
          canonical_reservation_id = ?,
          provider = ?,
          provider_reservation_id = ?,
          provider_calendar_id = ?,
          provider_edit_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE
          tenant_id = ?
          AND reservation_id = ?
        `,
      )
      .bind(

        canonicalReservationId,

        provider,

        providerReservationId,

        providerCalendarId,

        providerEditId,

        tenantId,

        reservationId,

      )
      .run();

  }

  // ============================================================
  // Recycle a historical cancelled reservation link
  //
  // The cancelled record is historical state. The reservation_links
  // row is reused as the current active identity anchor.
  //
  // IMPORTANT:
  // Old CRM identity MUST be cleared so a new reservation instance
  // never inherits the old cancelled GHL opportunity/contact.
  // ============================================================

  async recycleCancelledReservation(
    tenantId: string,
    reservationId: string,
    canonicalReservationId: string,
    provider: string,
    providerReservationId: string,
    providerCalendarId: string | null,
    providerEditId: string | null,
    revision: number,
    lifecycle: ReservationLifecycle,
  ): Promise<void> {

    await this.db
      .prepare(
        `
          UPDATE reservation_links
          SET
            canonical_reservation_id = ?,
            provider = ?,
            provider_reservation_id = ?,
            provider_calendar_id = ?,
            provider_edit_id = ?,
            revision = ?,
            last_event_id = NULL,
            contact_id = NULL,
            opportunity_id = NULL,
            lifecycle = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE
            tenant_id = ?
            AND reservation_id = ?
            AND lifecycle = 'cancelled'
        `,
      )
      .bind(
        canonicalReservationId,
        provider,
        providerReservationId,
        providerCalendarId,
        providerEditId,
        revision,
        lifecycle,
        tenantId,
        reservationId,
      )
      .run();
  }


  // ============================================================
  // Update revision only when newer
  // ============================================================

  async updateRevisionIfNewer(
    tenantId:
      string,

    reservationId:
      string,

    revision:
      number,
  ):
    Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          UPDATE reservation_links
          SET
            revision = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE
            tenant_id = ?
            AND reservation_id = ?
            AND (
              revision IS NULL
              OR revision < ?
            )
          `,
        )
        .bind(

          revision,

          tenantId,

          reservationId,

          revision,

        )
        .run();


    return (
      result.meta.changes ===
      1
    );

  }


  // ============================================================
  // Atomically accept reservation revision
  //
  // Only the request that successfully advances the stored
  // revision is allowed to continue.
  // ============================================================

  async acceptRevision(
    tenantId:
      string,

    reservationId:
      string,

    revision:
      number,
  ):
    Promise<boolean> {

    const result =
      await this.db
        .prepare(
          `
          UPDATE reservation_links
          SET
            revision = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE
            tenant_id = ?
            AND reservation_id = ?
            AND (
              revision IS NULL
              OR revision < ?
            )
          `,
        )
        .bind(

          revision,

          tenantId,

          reservationId,

          revision,

        )
        .run();


    return (
      result.meta.changes ===
      1
    );

  }

  // ============================================================
  // Attach CRM identity to an existing reservation link.
  //
  // Core may establish the reservation/provider identity before
  // CRM reconciliation. This method attaches the CRM identities
  // later without creating a second reservation link.
  // ============================================================

    async updateCrmIdentity(
    tenantId:
      string,

    reservationId:
      string,

    contactId:
      string,

    opportunityId:
      string,
  ):
    Promise<void> {

    /*
     * ------------------------------------------------------------
     * CRM OPPORTUNITY OWNERSHIP GUARD
     * ------------------------------------------------------------
     *
     * One GHL opportunity must belong to only one
     * Core reservation within the same tenant.
     *
     * Do not allow a new reservation to reuse the
     * opportunity belonging to another reservation.
     */

    const existingOwner =
      await this.findByOpportunityId(
        tenantId,
        opportunityId,
      );


    if (
      existingOwner &&
      existingOwner.reservationId !==
        reservationId
    ) {

      throw new Error(
        `CRM opportunity '${opportunityId}' is already linked to reservation '${existingOwner.reservationId}'. Cannot attach it to reservation '${reservationId}'.`,
      );

    }


    await this.db
      .prepare(
        `
        UPDATE reservation_links
        SET
          contact_id = ?,
          opportunity_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE
          tenant_id = ?
          AND reservation_id = ?
        `,
      )
      .bind(

        contactId,

        opportunityId,

        tenantId,

        reservationId,

      )
      .run();

  }

  // ============================================================
  // Update lifecycle
  // ============================================================

  async updateLifecycle(
    tenantId:
      string,

    reservationId:
      string,

    lifecycle:
      string,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        UPDATE reservation_links
        SET
          lifecycle = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE
          tenant_id = ?
          AND reservation_id = ?
        `,
      )
      .bind(

        lifecycle,

        tenantId,

        reservationId,

      )
      .run();

  }


  // ============================================================
  // Delete reservation link
  // ============================================================

  async delete(
    tenantId:
      string,

    reservationId:
      string,
  ):
    Promise<void> {

    await this.db
      .prepare(
        `
        DELETE FROM reservation_links
        WHERE
          tenant_id = ?
          AND reservation_id = ?
        `,
      )
      .bind(

        tenantId,

        reservationId,

      )
      .run();

  }

}
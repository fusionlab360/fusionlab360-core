import {
  createCanonicalReservationId,
} from "../../canonical/reservation";

import type {
  ReservationProviderIdentity,
} from "../../canonical/reservation";

import {
  createRepositories,
} from "../../persistence/factory";


export interface ReservationIdentityMigrationResult {

  matched: boolean;

  migrated: boolean;

  canonicalReservationId?:
    string;

  providerIdentity?:
    ReservationProviderIdentity;

}


export class ReservationIdentityService {

  async reconcile(
    db: D1Database,
    tenantId: string,
    providerIdentity:
      ReservationProviderIdentity,
  ): Promise<
    ReservationIdentityMigrationResult
  > {

    const repositories =
      createRepositories(
        db,
      );


    const existing =
      await repositories
        .reservationLinkRepository
        .findByProviderReservationId(
          tenantId,
          providerIdentity.provider,
          providerIdentity.providerReservationId,
        );


    if (!existing) {

      return {

        matched:
          false,

        migrated:
          false,

        providerIdentity,

      };

    }


    const canonicalReservationId =
      existing.canonicalReservationId ??
      createCanonicalReservationId();


    const identityChanged =
      existing.providerCalendarId !==
        providerIdentity.providerCalendarId ||

      existing.providerEditId !==
        providerIdentity.providerEditId;


    if (
      identityChanged ||
      !existing.canonicalReservationId
    ) {

      await repositories
  .reservationLinkRepository
  .updateProviderIdentity(
    tenantId,
    existing.reservationId,
    canonicalReservationId,
    providerIdentity.provider,
    providerIdentity.providerReservationId,
    providerIdentity.providerCalendarId ??
      null,
    providerIdentity.providerEditId ??
      null,
  );

    }


    return {

      matched:
        true,

      migrated:
        identityChanged ||
        !existing.canonicalReservationId,

      canonicalReservationId,

      providerIdentity,

    };

  }

}

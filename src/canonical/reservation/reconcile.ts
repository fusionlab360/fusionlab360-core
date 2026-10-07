import type {
  ReservationProviderIdentity,
} from "./provider-identity";


export type ReservationIdentityMatch =
  | "exact"
  | "provider_reservation"
  | "provider_calendar"
  | "none";


export interface ReservationIdentityCandidate {

  canonicalReservationId: string;

  provider: string;

  providerReservationId: string;

  providerCalendarId?: string;

  providerEditId?: string;

}


export interface ReservationIdentityResolution {

  match:
    ReservationIdentityMatch;

  canonicalReservationId?:
    string;

  providerIdentity:
    ReservationProviderIdentity;

}


export function reconcileReservationIdentity(
  providerIdentity:
    ReservationProviderIdentity,
  candidates:
    ReservationIdentityCandidate[],
): ReservationIdentityResolution {

  // ============================================================
  // 1. Exact provider identity
  //
  // Same provider
  // Same reservation ID
  // Same EditId
  // ============================================================

  const exact =
    candidates.find(
      candidate =>

        candidate.provider ===
          providerIdentity.provider &&

        candidate.providerReservationId ===
          providerIdentity.providerReservationId &&

        Boolean(
          providerIdentity.providerEditId,
        ) &&

        Boolean(
          candidate.providerEditId,
        ) &&

        candidate.providerEditId ===
          providerIdentity.providerEditId,
    );


  if (exact) {

    return {

      match:
        "exact",

      canonicalReservationId:
        exact.canonicalReservationId,

      providerIdentity,

    };

  }


  // ============================================================
  // 2. Same provider + same provider reservation ID
  //
  // This is the important EditId migration case.
  //
  // Example:
  //
  // EditId A
  //     ↓
  // EditId B
  //
  // Same provider reservation → same Core reservation.
  // ============================================================

  const providerReservation =
    candidates.find(
      candidate =>

        candidate.provider ===
          providerIdentity.provider &&

        candidate.providerReservationId ===
          providerIdentity.providerReservationId,
    );


  if (providerReservation) {

    return {

      match:
        "provider_reservation",

      canonicalReservationId:
        providerReservation
          .canonicalReservationId,

      providerIdentity,

    };

  }


  // ============================================================
  // 3. Same provider + same calendar identity
  //
  // Secondary fallback only.
  // ============================================================

  const providerCalendar =
    providerIdentity.providerCalendarId
      ? candidates.find(
          candidate =>

            candidate.provider ===
              providerIdentity.provider &&

            candidate.providerCalendarId ===
              providerIdentity.providerCalendarId,
        )
      : undefined;


  if (providerCalendar) {

    return {

      match:
        "provider_calendar",

      canonicalReservationId:
        providerCalendar
          .canonicalReservationId,

      providerIdentity,

    };

  }


  // ============================================================
  // 4. No safe identity match
  //
  // Never guess using:
  //
  // - guest name
  // - phone
  // - email
  // - room number
  // ============================================================

  return {

    match:
      "none",

    providerIdentity,

  };

}
export type ReservationEventType =
  | "reservation.created"
  | "reservation.updated"
  | "reservation.confirmed"
  | "reservation.arrival_today"
  | "reservation.checked_in"
  | "reservation.checked_out"
  | "reservation.completed"
  | "reservation.cancelled"
  | "reservation.no_show";

export interface ReservationEvent {

  type: ReservationEventType;

  tenantId: string;

  reservationId: string;

  contactId: string;

  opportunityId?: string;

  occurredAt: Date;

}
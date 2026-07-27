export type ReservationStatus =
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface ReservationSyncRequest {
  status?: ReservationStatus[];

  checkInFrom?: string;

  checkInTo?: string;

  checkOutFrom?: string;

  checkOutTo?: string;

  modifiedAfter?: string;
}
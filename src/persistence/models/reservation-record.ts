export interface ReservationRecord {

  tenantId: string;

  canonicalReservationId: string;

  provider: string;

  providerReservationId: string;

  providerCalendarId?: string;

  providerEditId?: string;

  revision: number;

  lifecycle: string;

  payload: string;

  createdAt: string;

  updatedAt: string;

}
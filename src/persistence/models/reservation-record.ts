export interface ReservationRecord {

  tenantId: string;

  canonicalReservationId: string;

  provider: string;

  /** Provider connection scope; optional for records created before this identity was added. */
  providerConnectionId?: string;

  /** Provider property scope; optional for records created before this identity was added. */
  providerPropertyId?: string;

  providerReservationId: string;

  providerCalendarId?: string;

  providerEditId?: string;

  revision: number;

  lifecycle: string;

  payload: string;

  createdAt: string;

  updatedAt: string;

}

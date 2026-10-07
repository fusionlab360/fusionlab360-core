export interface IntegrationEvent<
  TPayload = unknown,
> {

  eventId: string;

  eventType: string;

  aggregateType: string;

  aggregateId: string;

  tenantId: string;

  provider?: string;

  revision?: number;

  occurredAt: string;

  payload: TPayload;

}
export interface IntegrationEventRecord {

  eventId: string;

  tenantId: string;

  eventType: string;

  aggregateType: string;

  aggregateId: string;

  provider?: string;

  revision?: number;

  occurredAt: string;

  receivedAt: string;

  payload: string;

}
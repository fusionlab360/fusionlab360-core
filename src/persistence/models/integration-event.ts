export interface IntegrationEventRecord {

  eventId:
    string;

  tenantId:
    string;

  eventType:
    string;

  aggregateType:
    string;

  aggregateId:
    string;

  provider?:
    string;

  revision?:
    number;

  occurredAt:
    string;

  receivedAt:
    string;

  payload:
    string;

  processingStatus?:
    | "received"
    | "processing"
    | "processed"
    | "failed"
    | "dead_letter";

  processingAttempts?:
    number;

  processingStartedAt?:
    string |
    null;

  processedAt?:
    string |
    null;

  lastErrorCode?:
    string |
    null;

  lastErrorMessage?:
    string |
    null;
}
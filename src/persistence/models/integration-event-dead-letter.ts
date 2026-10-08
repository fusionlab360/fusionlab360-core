export interface IntegrationEventDeadLetter {

  id?:
    number;

  eventId:
    string;

  tenantId:
    string;

  errorCode:
    string;

  errorMessage:
    string;

  retryable:
    boolean;

  attempts:
    number;

  payload:
    string;

  createdAt:
    string;

  updatedAt:
    string;
}
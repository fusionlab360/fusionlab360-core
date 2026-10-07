export type IntegrationEventErrorCode =
  | "DUPLICATE_EVENT"
  | "STALE_EVENT"
  | "INVALID_EVENT"
  | "PROVIDER_NORMALIZATION_FAILED"
  | "PROVIDER_UNSUPPORTED"
  | "TENANT_CONTEXT_INVALID"
  | "PERSISTENCE_FAILURE"
  | "UNKNOWN";


export type IntegrationEventErrorSeverity =
  | "info"
  | "warning"
  | "error";


export interface IntegrationEventError {

  code:
    IntegrationEventErrorCode;

  severity:
    IntegrationEventErrorSeverity;

  message:
    string;

  retryable:
    boolean;

  cause?:
    unknown;

}

export class IntegrationEventProcessingError
  extends Error {

  readonly code:
    IntegrationEventErrorCode;

  readonly severity:
    IntegrationEventErrorSeverity;

  readonly retryable:
    boolean;

  readonly causeValue:
    unknown;


  constructor(
    details:
      IntegrationEventError,
  ) {

    super(
      details.message,
    );

    this.name =
      "IntegrationEventProcessingError";

    this.code =
      details.code;

    this.severity =
      details.severity;

    this.retryable =
      details.retryable;

    this.causeValue =
      details.cause;

  }

}
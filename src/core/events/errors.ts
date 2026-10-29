export type IntegrationEventErrorCode =
  | "DUPLICATE_EVENT"
  | "STALE_EVENT"
  | "INVALID_EVENT"
  | "PROVIDER_NORMALIZATION_FAILED"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_PAYLOAD_REJECTED"
  | "PROVIDER_IDENTITY_REJECTED"
  | "GHL_CONTACT_LOOKUP_FAILED"
  | "GHL_CONTACT_MISMATCH"
  | "META_CONNECTION_UNAVAILABLE"
  | "META_CONVERSATION_NOT_UNIQUE"
  | "META_CUSTOMER_WINDOW_EXPIRED"
  | "META_CREDENTIAL_UNAVAILABLE"
  | "PROVIDER_TRANSIENT"
  | "PROVIDER_UNSUPPORTED"
  | "TENANT_CONTEXT_INVALID"
  | "PERSISTENCE_FAILURE"
  | "OUTBOUND_DELIVERY_UNKNOWN"
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

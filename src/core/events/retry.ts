import type {
  IntegrationEventErrorCode,
} from "./errors";


export interface RetryPolicyResult {

  retryable:
    boolean;

  maxAttempts:
    number;

  baseDelaySeconds:
    number;

}


const DEFAULT_MAX_ATTEMPTS = 5;

const DEFAULT_BASE_DELAY_SECONDS = 10;


export function getIntegrationEventRetryPolicy(
  code:
    IntegrationEventErrorCode,
): RetryPolicyResult {

  switch (code) {

    // ----------------------------------------------------------
    // Permanent / deterministic errors
    // ----------------------------------------------------------

    case "DUPLICATE_EVENT":

    case "STALE_EVENT":

    case "INVALID_EVENT":

    case "PROVIDER_NORMALIZATION_FAILED":

    case "PROVIDER_REQUEST_REJECTED":

    case "PROVIDER_PAYLOAD_REJECTED":

    case "PROVIDER_IDENTITY_REJECTED":

    case "GHL_CONTACT_MISMATCH":

    case "META_CONNECTION_UNAVAILABLE":

    case "META_CONVERSATION_NOT_UNIQUE":

    case "META_CUSTOMER_WINDOW_EXPIRED":

    case "PROVIDER_UNSUPPORTED":

    case "TENANT_CONTEXT_INVALID":

    case "OUTBOUND_DELIVERY_UNKNOWN":

      return {

        retryable:
          false,

        maxAttempts:
          0,

        baseDelaySeconds:
          0,

      };

    case "PROVIDER_TRANSIENT":

    case "GHL_CONTACT_LOOKUP_FAILED":

    case "META_CREDENTIAL_UNAVAILABLE":

      return {

        retryable:
          true,

        maxAttempts:
          DEFAULT_MAX_ATTEMPTS,

        baseDelaySeconds:
          DEFAULT_BASE_DELAY_SECONDS,

      };


    // ----------------------------------------------------------
    // Temporary persistence/infrastructure failure
    // ----------------------------------------------------------

    case "PERSISTENCE_FAILURE":

      return {

        retryable:
          true,

        maxAttempts:
          DEFAULT_MAX_ATTEMPTS,

        baseDelaySeconds:
          DEFAULT_BASE_DELAY_SECONDS,

      };


    // ----------------------------------------------------------
    // Unknown error
    //
    // Retry conservatively because the underlying cause
    // may be temporary infrastructure failure.
    // ----------------------------------------------------------

    case "UNKNOWN":

    default:

      return {

        retryable:
          true,

        maxAttempts:
          DEFAULT_MAX_ATTEMPTS,

        baseDelaySeconds:
          DEFAULT_BASE_DELAY_SECONDS,

      };

  }

}

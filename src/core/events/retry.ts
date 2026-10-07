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

    case "PROVIDER_UNSUPPORTED":

    case "TENANT_CONTEXT_INVALID":

      return {

        retryable:
          false,

        maxAttempts:
          0,

        baseDelaySeconds:
          0,

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
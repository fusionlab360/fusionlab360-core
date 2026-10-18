/** Maximum time spent waiting on a single provider request. */
export const GEMINI_ATTEMPT_TIMEOUT_MS = 8_000;
export const CLOUDFLARE_AI_ATTEMPT_TIMEOUT_MS = 12_000;

/** Covers initial generation, provider fallback, and the one bounded repair attempt. */
export const AI_GENERATION_DEADLINE_MS = 30_000;

export function createProviderAttemptSignal(
  requestSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;
}

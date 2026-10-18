import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
  AIProviderAttemptDiagnostic,
} from "../contracts";

class ProviderAttemptsError extends Error {
  constructor(readonly providerAttempts: AIProviderAttemptDiagnostic[]) {
    super("All configured AI providers failed.");
    this.name = "ProviderAttemptsError";
  }
}

function outcome(error: unknown): "error" | "timeout" {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "error";
}

function classifyFailure(
  error: unknown,
  provider: string,
  overallSignal?: AbortSignal,
): Pick<AIProviderAttemptDiagnostic, "failureKind" | "httpStatus"> {
  if (overallSignal?.aborted || outcome(error) === "timeout") {
    return { failureKind: "timeout" };
  }
  if (!(error instanceof Error)) {
    return { failureKind: "unknown" };
  }
  if (error instanceof TypeError) {
    return { failureKind: "type_error" };
  }

  if (provider === "gemini") {
    const statusMatch = /^Gemini request failed with HTTP ([1-5]\d\d)\.$/.exec(error.message);
    if (statusMatch) {
      return { failureKind: "http_response", httpStatus: Number(statusMatch[1]) };
    }
    if (error.message === "Gemini returned an invalid response shape." || error.message === "Gemini returned an invalid candidates shape.") {
      return { failureKind: "invalid_response" };
    }
    if (error.message === "Gemini returned an empty response.") {
      return { failureKind: "empty_response" };
    }
  }

  return { failureKind: "provider_error" };
}

async function attempt(
  provider: string,
  run: () => Promise<AIChatResponse>,
  attempts: AIProviderAttemptDiagnostic[],
  overallSignal?: AbortSignal,
): Promise<AIChatResponse> {
  const startedAt = performance.now();
  try {
    const response = await run();
    attempts.push({ provider, durationMs: Math.round(performance.now() - startedAt), outcome: "success" });
    return response;
  } catch (error: unknown) {
    const failure = classifyFailure(error, provider, overallSignal);
    attempts.push({
      provider,
      durationMs: Math.round(performance.now() - startedAt),
      outcome: overallSignal?.aborted ? "timeout" : outcome(error),
      ...failure,
    });
    throw error;
  }
}


export class HybridAIProvider
  implements AIProvider {

  constructor(
    private readonly cloudflare:
      AIProvider,

    private readonly gemini:
      AIProvider,
  ) {}


  async chat(
    request:
      AIChatRequest,
  ): Promise<
    AIChatResponse
  > {
    const attempts: AIProviderAttemptDiagnostic[] = [];

    /*
     * --------------------------------------------------
     * Structured work
     * --------------------------------------------------
     */

    if (
      request.task ===
      "structured"
    ) {
      try {
        const response = await attempt("cloudflare-workers-ai", () => this.cloudflare.chat(request), attempts, request.signal);
        return { ...response, providerAttempts: attempts, fallbackUsed: false };
      } catch {
        throw new ProviderAttemptsError(attempts);
      }

    }




    /*
     * --------------------------------------------------
     * Response / reasoning work
     * --------------------------------------------------
     */

    if (
      request.task ===
        "response" ||

      request.task ===
        "reasoning"
    ) {

      try {

        const response = await attempt("gemini", () => this.gemini.chat(request), attempts, request.signal);
        return { ...response, providerAttempts: attempts, fallbackUsed: false };

      } catch (
        error:
          unknown
      ) {

        console.warn(
          "Gemini AI failed. Falling back to Cloudflare AI.",

          {
            failureKind: classifyFailure(error, "gemini", request.signal).failureKind,

            task:
              request.task,

          },
        );


        try {
          const response = await attempt("cloudflare-workers-ai", () => this.cloudflare.chat(request), attempts, request.signal);
          return { ...response, providerAttempts: attempts, fallbackUsed: true };
        } catch {
          throw new ProviderAttemptsError(attempts);
        }
      }
    }


    /*
     * --------------------------------------------------
     * Backward compatibility
     * --------------------------------------------------
     */

    try {
      const response = await attempt("cloudflare-workers-ai", () => this.cloudflare.chat(request), attempts, request.signal);
      return { ...response, providerAttempts: attempts, fallbackUsed: false };
    } catch {
      throw new ProviderAttemptsError(attempts);
    }

  }

  async chatFallback(
  request: AIChatRequest,
): Promise<AIChatResponse> {
  const attempts: AIProviderAttemptDiagnostic[] = [];
  // Structured and unspecified tasks normally use Cloudflare,
  // so Gemini is their alternative provider.
  if (
    request.task === "structured" ||
    request.task === undefined
  ) {
    try {
      const response = await attempt("gemini", () => this.gemini.chat(request), attempts, request.signal);
      return { ...response, providerAttempts: attempts, fallbackUsed: true };
    } catch {
      throw new ProviderAttemptsError(attempts);
    }
  }

  // Response and reasoning tasks normally use Gemini,
  // so Cloudflare is their alternative provider.
  try {
    const response = await attempt("cloudflare-workers-ai", () => this.cloudflare.chat(request), attempts, request.signal);
    return { ...response, providerAttempts: attempts, fallbackUsed: true };
  } catch {
    throw new ProviderAttemptsError(attempts);
  }
}
}

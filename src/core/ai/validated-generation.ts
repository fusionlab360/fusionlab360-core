
import type {
  AIChatMessage,
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "./contracts";

export interface AIResponseValidation<T> {
  valid: boolean;
  value: T;
  reason?: string;
}

export interface ValidatedGenerationOptions<T> {
  provider: AIProvider;
  request: AIChatRequest;

  validate: (
    response: AIChatResponse,
  ) => AIResponseValidation<T>;

  correctionInstruction: string;
  maxValidationRetries?: number;
  preferFallbackOnRetry?: boolean;
}

export interface ValidatedGenerationResult<T> {
  response: AIChatResponse;
  validation: AIResponseValidation<T>;
  attempts: number;
  fallbackUsed: boolean;
  retryError?: string;
}

function addCorrectionInstruction(
  request: AIChatRequest,
  correction: string,
): AIChatRequest {
  const messages: AIChatMessage[] =
    request.messages.map((message) => ({
      ...message,
    }));

  const systemIndex = messages.findIndex(
    (message) => message.role === "system",
  );

  const correctionBlock = [
    "VALIDATION CORRECTION",
    correction,
    "Return only the corrected response.",
  ].join("\n");

  if (systemIndex >= 0) {
    const systemMessage = messages[systemIndex];

    messages[systemIndex] = {
      ...systemMessage,
      content: `${systemMessage.content}\n\n${correctionBlock}`,
    };
  } else {
    messages.unshift({
      role: "system",
      content: correctionBlock,
    });
  }

  return {
    ...request,
    messages,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export async function generateValidatedResponse<T>(
  options: ValidatedGenerationOptions<T>,
): Promise<ValidatedGenerationResult<T>> {
  const requestedRetries =
    typeof options.maxValidationRetries === "number" &&
    Number.isFinite(options.maxValidationRetries)
      ? Math.floor(options.maxValidationRetries)
      : 1;

  const maxRetries = Math.min(
    Math.max(requestedRetries, 0),
    1,
  );


let response: AIChatResponse;

let attempts = 1;
let fallbackUsed = false;
let retryError: string | undefined;

// Recover if the primary provider throws before returning a response.
try {
  response = await options.provider.chat(options.request);
} catch (primaryError: unknown) {
  if (!options.provider.chatFallback) {
    throw primaryError;
  }

  attempts += 1;
  fallbackUsed = true;

  try {
    response = await options.provider.chatFallback(
      options.request,
    );
  } catch (fallbackError: unknown) {
    throw new Error(
      [
        `Primary AI provider failed: ${errorMessage(primaryError)}`,
        `Fallback AI provider failed: ${errorMessage(fallbackError)}`,
      ].join("; "),
    );
  }
}

let validation = options.validate(response);

 for (
  let retryIndex = 0;
  !validation.valid &&
  retryIndex < maxRetries &&
  attempts < 2;
  retryIndex += 1
) {
    const correction = [
      options.correctionInstruction.trim(),
      validation.reason
        ? `Validation feedback: ${validation.reason.slice(0, 500)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const retryRequest = addCorrectionInstruction(
      options.request,
      correction,
    );

    attempts += 1;

    try {
      if (
        options.preferFallbackOnRetry !== false &&
        options.provider.chatFallback
      ) {
        fallbackUsed = true;
        response = await options.provider.chatFallback(retryRequest);
      } else {
        response = await options.provider.chat(retryRequest);
      }
    } catch (error: unknown) {
      retryError = errorMessage(error);
      break;
    }

    validation = options.validate(response);
  }

  return {
    response,
    validation,
    attempts,
    fallbackUsed,
    ...(retryError ? { retryError } : {}),
  };
}

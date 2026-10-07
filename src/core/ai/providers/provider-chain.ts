import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../index";

export interface RegisteredAIProvider {
  id: string;
  provider: AIProvider;
  priority: number;

  enabled?: boolean;

  supports?: (
    request: AIChatRequest,
  ) => boolean;
}

export interface AIProviderChainOptions {
  onAttempt?: (
    providerId: string,
    request: AIChatRequest,
  ) => void;

  onFailure?: (
    providerId: string,
    error: unknown,
  ) => void;

  onSuccess?: (
    providerId: string,
    response: AIChatResponse,
  ) => void;
}

export function createAIProviderChain(
  registrations: RegisteredAIProvider[],
  options: AIProviderChainOptions = {},
): AIProvider {
  const providers =
    registrations
      .filter(
        (item) =>
          item.enabled !== false,
      )
      .sort(
        (a, b) =>
          a.priority -
          b.priority,
      );

  if (
    providers.length === 0
  ) {
    throw new Error(
      "No enabled AI providers are configured.",
    );
  }

  return {
    async chat(
      request: AIChatRequest,
    ): Promise<AIChatResponse> {
      let lastError: unknown =
        null;

      for (
        const registration of
          providers
      ) {
        if (
          registration.supports &&
          !registration.supports(
            request,
          )
        ) {
          continue;
        }

        try {
          options.onAttempt?.(
            registration.id,
            request,
          );

          const response =
            await registration.provider.chat(
              request,
            );

          options.onSuccess?.(
            registration.id,
            response,
          );

          return response;
        } catch (
          error
        ) {
          lastError =
            error;

          options.onFailure?.(
            registration.id,
            error,
          );
        }
      }

      throw (
        lastError instanceof Error
          ? lastError
          : new Error(
              "All configured AI providers failed.",
            )
      );
    },
  };
}
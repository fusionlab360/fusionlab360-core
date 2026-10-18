import type {
  AIChatMessage,
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../../../core/ai/contracts";
import {
  createProviderAttemptSignal,
  GEMINI_ATTEMPT_TIMEOUT_MS,
} from "../../../core/ai/provider-timeout";


const DEFAULT_MODEL =
  "gemini-3.8-flash";


interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

function buildGeminiContents(
  messages: AIChatMessage[],
) {

  return messages
    .filter(
      (
        message,
      ) =>
        message.role !== "system" &&
        message.content.trim().length > 0,
    )
    .map(
      (
        message,
      ) => ({
        role:
          message.role === "assistant"
            ? "model"
            : "user",

        parts: [
          {
            text:
              message.content,
          },
        ],
      }),
    );
}


function getSystemInstruction(
  messages: AIChatMessage[],
) {

  const systemMessages =
    messages
      .filter(
        (
          message,
        ) =>
          message.role === "system" &&
          message.content.trim().length > 0,
      )
      .map(
        (
          message,
        ) =>
          message.content.trim(),
      );


  if (
    systemMessages.length === 0
  ) {
    return undefined;
  }


  return {
    parts: [
      {
        text:
          systemMessages.join(
            "\n\n",
          ),
      },
    ],
  };
}


function extractGeminiText(
  response:
    GeminiGenerateContentResponse,
): string {

  const text =
    response
      .candidates
      ?.flatMap(
        (
          candidate,
        ) =>
          candidate
            .content
            ?.parts
            ?? [],
      )
      .map(
        (
          part,
        ) =>
          part.text?.trim() ?? "",
      )
      .filter(
        Boolean,
      )
      .join("\n")
      .trim();


  if (!text) {
    throw new Error(
      "Gemini returned an empty response.",
    );
  }


  return text;
}


export function createGeminiAIProvider(
  apiKey:
    string,

  model:
    string =
      DEFAULT_MODEL,
): AIProvider {

  if (
    !apiKey?.trim()
  ) {
    throw new Error(
      "Missing Gemini API key.",
    );
  }


  if (
    !model?.trim()
  ) {
    throw new Error(
      "Missing Gemini model.",
    );
  }


  return {

    async chat(
      request:
        AIChatRequest,
    ): Promise<
      AIChatResponse
    > {

      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model,
        )}:generateContent`;


      const body:
        Record<
          string,
          unknown
        > = {

        contents:
          buildGeminiContents(
            request.messages,
          ),

        generationConfig: {

            maxOutputTokens:
                request.maxTokens ??
                300,
            },
      };


      const systemInstruction =
        getSystemInstruction(
          request.messages,
        );


      if (
        systemInstruction
      ) {

        body.systemInstruction =
          systemInstruction;
      }


      const response =
        await fetch(
          endpoint,
          {
            method:
              "POST",

            // Bound every request and propagate the overall generation deadline.
            signal: createProviderAttemptSignal(
              request.signal,
              GEMINI_ATTEMPT_TIMEOUT_MS,
            ),

            headers: {
              "Content-Type":
                "application/json",

              "x-goog-api-key":
                apiKey,
            },

            body:
              JSON.stringify(
                body,
              ),
          },
        );


      if (
        !response.ok
      ) {

        throw new Error(
          `Gemini request failed with HTTP ${response.status}.`,
        );
      }


      const payload: unknown = await response.json();
      const data = parseGeminiResponse(payload);


     const finishReason =
  data.candidates?.[0]?.finishReason;

      return {
        text:
          extractGeminiText(
            data,
          ),

        provider:
          "gemini",

        model,

        finishReason,

        truncated:
          finishReason ===
          "MAX_TOKENS",
      };
    },
  };
}

function parseGeminiResponse(value: unknown): GeminiGenerateContentResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini returned an invalid response shape.");
  }
  const candidates = (value as { candidates?: unknown }).candidates;
  if (candidates === undefined) return {};
  if (!Array.isArray(candidates)) {
    throw new Error("Gemini returned an invalid candidates shape.");
  }
  return {
    candidates: candidates.flatMap((candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return [];
      const raw = candidate as { finishReason?: unknown; content?: unknown };
      const content = raw.content && typeof raw.content === "object"
        ? raw.content as { parts?: unknown }
        : undefined;
      const parts = Array.isArray(content?.parts)
        ? content.parts.flatMap((part: unknown) => {
          if (!part || typeof part !== "object") return [];
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? [{ text }] : [];
        })
        : undefined;
      return [{
        ...(typeof raw.finishReason === "string" ? { finishReason: raw.finishReason } : {}),
        ...(content ? { content: { ...(parts ? { parts } : {}) } } : {}),
      }];
    }),
  };
}

import type {
  AIChatMessage,
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../../../core/ai/contracts";


const DEFAULT_MODEL =
  "gemini-3.8-flash";


interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
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

        let details:
          unknown;

        try {

          details =
            await response.json();

        } catch {

          details =
            await response.text();
        }


        throw new Error(
          `Gemini request failed with HTTP ${response.status}: ${JSON.stringify(details)}`,
        );
      }


      const data =
        await response.json() as
          GeminiGenerateContentResponse;


      return {

        text:
          extractGeminiText(
            data,
          ),

        provider:
          "gemini",

        model,
      };
    },
  };
}
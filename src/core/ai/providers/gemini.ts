import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../contracts";


interface GeminiGenerateContentResponse {

  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;

  error?: {
    message?: string;
  };
}


/*
 * --------------------------------------------------
 * Gemini request timeout
 * --------------------------------------------------
 *
 * Prevent Gemini from holding the Worker execution
 * open indefinitely.
 */

const GEMINI_TIMEOUT_MS =
  8_000;


export class GeminiProvider
  implements AIProvider {

  private readonly apiKey:
    string;

  private readonly model:
    string;


  constructor(
    apiKey:
      string,

    model =
      "gemini-2.5-flash",
  ) {

    if (
      !apiKey
    ) {

      throw new Error(
        "GEMINI_API_KEY is not configured",
      );
    }


    this.apiKey =
      apiKey;

    this.model =
      model;
  }


  async chat(
    request:
      AIChatRequest,
  ): Promise<
    AIChatResponse
  > {

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${this.model}:generateContent?key=${this.apiKey}`;


    const contents =
      request.messages
        .filter(
          (
            message,
          ) =>
            message.role !==
            "system",
        )
        .map(
          (
            message,
          ) => ({

            role:
              message.role ===
              "assistant"
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


    const systemMessage =
      request.messages.find(
        (
          message,
        ) =>
          message.role ===
          "system",
      );


    const body:
      Record<
        string,
        unknown
      > = {

      contents,

      generationConfig: {

        ...(request.maxTokens !==
          undefined
          ? {
              maxOutputTokens:
                request.maxTokens,
            }
          : {}),

        ...(request.temperature !==
          undefined
          ? {
              temperature:
                request.temperature,
            }
          : {}),

      },
    };


    if (
      systemMessage
    ) {

      body.systemInstruction = {

        parts: [

          {
            text:
              systemMessage.content,
          },

        ],
      };
    }


    /*
     * ------------------------------------------------
     * Abort Gemini when it takes too long.
     * ------------------------------------------------
     */

    const controller =
      new AbortController();


    const timeout =
      setTimeout(
        () => {

          controller.abort();

        },

        GEMINI_TIMEOUT_MS,
      );


    let response:
      Response;


    try {

      response =
        await fetch(
          url,

          {
            method:
              "POST",

            headers: {

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                body,
              ),

            signal:
              controller.signal,
          },
        );

    } catch (
      error:
        unknown
    ) {

      if (
        controller.signal.aborted
      ) {

        throw new Error(
          `Gemini request timed out after ${GEMINI_TIMEOUT_MS}ms.`,
        );

      }


      throw error;

    } finally {

      clearTimeout(
        timeout,
      );

    }


    const data =
      (
        await response.json()
      ) as
        GeminiGenerateContentResponse;


    if (
      !response.ok
    ) {

      throw new Error(
        data.error?.message ??
          `Gemini API request failed with status ${response.status}`,
      );
    }


    const text =
      data.candidates
        ?.flatMap(
          (
            candidate,
          ) =>
            candidate
              .content
              ?.parts ??
            [],
        )
        .map(
          (
            part,
          ) =>
            part.text ??
            "",
        )
        .join(
          "",
        )
        .trim() ??
      "";


    if (
      !text
    ) {

      throw new Error(
        "Gemini returned an empty response",
      );
    }


    return {

      text,

      provider:
        "gemini",

      model:
        this.model,

    };
  }
}
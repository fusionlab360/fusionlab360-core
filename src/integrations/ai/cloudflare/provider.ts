import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../../../core/ai";

import {
  CLOUDFLARE_AI,
} from "./config";


/*
 * --------------------------------------------------
 * Cloudflare Workers AI raw response
 * --------------------------------------------------
 */

interface CloudflareAIRawResponse {

  response?:
    unknown;

  output_text?:
    unknown;

  output?:
    unknown;

  choices?:
    unknown;

  usage?:
    unknown;

  tool_calls?:
    unknown;
}


/*
 * --------------------------------------------------
 * Extract text from nested Responses API content
 * --------------------------------------------------
 */

function extractNestedText(
  value:
    unknown,
):
  string {

  if (
    value ===
      null ||

    value ===
      undefined
  ) {

    return "";
  }


  if (
    typeof value ===
    "string"
  ) {

    return value.trim();
  }


  if (
    Array.isArray(
      value,
    )
  ) {

    const parts =
      value
        .map(
          (
            item,
          ) =>
            extractNestedText(
              item,
            ),
        )
        .filter(
          (
            item,
          ) =>
            item.length >
            0,
        );

    return parts.join(
      "",
    ).trim();
  }


  if (
    typeof value ===
    "object"
  ) {

    const objectValue =
      value as Record<
        string,
        unknown
      >;


    /*
     * Common text-bearing fields.
     */

    for (
      const key of [
        "text",
        "value",
        "output_text",
        "content",
      ]
    ) {

      if (
        key in
        objectValue
      ) {

        const text =
          extractNestedText(
            objectValue[key],
          );

        if (
          text
        ) {

          return text;
        }
      }
    }


    /*
     * Responses API output items.
     */

    if (
      "message" in
      objectValue
    ) {

      const text =
        extractNestedText(
          objectValue.message,
        );

      if (
        text
      ) {

        return text;
      }
    }


    /*
     * Responses API output arrays.
     */

    if (
      "output" in
      objectValue
    ) {

      const text =
        extractNestedText(
          objectValue.output,
        );

      if (
        text
      ) {

        return text;
      }
    }
  }


  return "";
}


/*
 * --------------------------------------------------
 * Extract text from Workers AI response
 * --------------------------------------------------
 */

function extractText(
  raw:
    unknown,
):
  string {

  if (
    raw ===
      null ||

    raw ===
      undefined
  ) {

    throw new Error(
      "Cloudflare Workers AI returned no response.",
    );
  }


  /*
   * Normal string response.
   */

  if (
    typeof raw ===
    "string"
  ) {

    const text =
      raw.trim();


    if (
      text
    ) {

      return text;
    }
  }


  if (
    typeof raw !==
    "object"
  ) {

    throw new Error(
      `Cloudflare Workers AI returned an unsupported response type: ${typeof raw}.`,
    );
  }


  const result =
    raw as CloudflareAIRawResponse;


  /*
   * Standard Workers AI response.
   */

  const directResponse =
    extractNestedText(
      result.response,
    );

  if (
    directResponse
  ) {

    return directResponse;
  }


  /*
   * Responses API text field.
   */

  const outputText =
    extractNestedText(
      result.output_text,
    );

  if (
    outputText
  ) {

    return outputText;
  }


  /*
   * Responses API output array.
   */

  const output =
    extractNestedText(
      result.output,
    );

  if (
    output
  ) {

    return output;
  }


  /*
   * Chat Completions-style response.
   */

  if (
    Array.isArray(
      result.choices,
    )
  ) {

    const firstChoice =
      result.choices[0] as
        | Record<
            string,
            unknown
          >
        | undefined;


    const choiceText =
      extractNestedText(
        firstChoice?.message,
      );

    if (
      choiceText
    ) {

      return choiceText;
    }


    const choiceContent =
      extractNestedText(
        firstChoice?.text,
      );

    if (
      choiceContent
    ) {

      return choiceContent;
    }
  }


  /*
   * NEVER serialize the raw model response.
   *
   * reasoning_content is intentionally not returned.
   * If the provider gives us no customer-facing text,
   * fail safely so the upper AI layer can handle it.
   */

  throw new Error(
    "Cloudflare Workers AI returned no usable customer-facing text.",
  );
}


/*
 * --------------------------------------------------
 * Create Cloudflare AI provider
 * --------------------------------------------------
 */

export function createCloudflareAIProvider(
  ai:
    Ai,
):
  AIProvider {

  return {

    async chat(
      request:
        AIChatRequest,
    ):
      Promise<
        AIChatResponse
      > {

      /*
       * --------------------------------------------
       * Execute model
       * --------------------------------------------
       */

      const rawResponse =
        await ai.run(
          CLOUDFLARE_AI.model,

          {
            messages:
              request.messages,

            max_tokens:
              request.maxTokens ??
              CLOUDFLARE_AI.defaultMaxTokens,

            temperature:
              request.temperature ??
              CLOUDFLARE_AI.defaultTemperature,

            reasoning_effort:
               "low",
          },
        );


      const result =
        rawResponse as
          CloudflareAIRawResponse;


      /*
       * --------------------------------------------
       * Diagnostic logging
       * --------------------------------------------
       */

      console.log(
        "CLOUDFLARE AI RAW RESPONSE",
        {
          model:
            CLOUDFLARE_AI.model,

          responseType:
            typeof result.response,

          hasResponse:
            result.response !==
              undefined,

          hasOutputText:
            result.output_text !==
              undefined,

          hasOutput:
            result.output !==
              undefined,

          hasChoices:
            Array.isArray(
              result.choices,
            ),

          hasToolCalls:
            Array.isArray(
              result.tool_calls,
            ) &&
            result.tool_calls.length >
              0,

          finishReason:
            Array.isArray(
              result.choices,
            )
              ? (
                  result.choices[0] as
                    | Record<
                        string,
                        unknown
                      >
                    | undefined
                )?.finish_reason ??
                null
              : null,
        },
      );


      /*
       * --------------------------------------------
       * Extract normalized text
       * --------------------------------------------
       */

      const text =
        extractText(
          rawResponse,
        );


      /*
       * --------------------------------------------
       * Return provider-neutral response
       * --------------------------------------------
       */

      return {

        text,

        provider:
          CLOUDFLARE_AI.provider,

        model:
          CLOUDFLARE_AI.model,

      };
    },
  };
}
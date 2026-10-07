import type {
  AIChatRequest,
  AIChatResponse,
  AIProvider,
} from "../contracts";


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

    /*
     * --------------------------------------------------
     * Structured work
     * --------------------------------------------------
     */

    if (
      request.task ===
      "structured"
    ) {

      return this.cloudflare.chat(
        request,
      );
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

        return await this.gemini.chat(
          request,
        );

      } catch (
        error:
          unknown
      ) {

        console.warn(
          "Gemini AI failed. Falling back to Cloudflare AI.",

          {
            error:
              error instanceof Error
                ? error.message
                : String(error),

            task:
              request.task,

          },
        );


        return this.cloudflare.chat(
          request,
        );
      }
    }


    /*
     * --------------------------------------------------
     * Backward compatibility
     * --------------------------------------------------
     */

    return this.cloudflare.chat(
      request,
    );
  }
}
import type {
  Context,
} from "hono";


import type {
  AppBindings,
  AppVariables,
} from "../../config/app";


import {
  resolveAIProvider,
} from "../../core/ai";


export async function testAIController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const body =
    await c.req.json<{
      message?: string;

      provider?:
        | "cloudflare"
        | "gemini"
        | "hybrid";

      task?:
        | "structured"
        | "response"
        | "reasoning";

        model?:
          string;
    }>();


  if (
    !body.message?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "message is required.",
      },

      400,
    );
  }


  const selectedProvider =
    body.provider ??
    "hybrid";


  const selectedTask =
    body.task ??
    "response";


  const ai =
    resolveAIProvider(
      c.env.AI,

      {
        provider:
          selectedProvider,

        geminiApiKey:
          c.env.GEMINI_API_KEY,

        geminiModel:
          body.model,
      },
    );


  const result =
    await ai.chat({

      messages: [

        {
          role:
            "system",

          content:
            "You are the FusionLab360 AI receptionist. Reply naturally and briefly.",
        },

        {
          role:
            "user",

          content:
            body.message,
        },
      ],


      task:
        selectedTask,


      maxTokens:
        150,


      temperature:
        0.3,
    });


  return c.json({

    success:
      true,

    requestedProvider:
      selectedProvider,

    task:
      selectedTask,

    provider:
      result.provider,

    model:
      result.model,

    response:
      result.text,
  });
}
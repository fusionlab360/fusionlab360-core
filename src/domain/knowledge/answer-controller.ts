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

import {
  answerKnowledgeQuestion,
} from "./answer-service";


interface KnowledgeAnswerRequest {

  query?:
    unknown;

  topK?:
    unknown;
}


export async function answerKnowledgeController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const body =
    await c.req.json<
      KnowledgeAnswerRequest
    >();


  const query =
    typeof body.query ===
      "string"
      ? body.query.trim()
      : "";


  if (
    !query
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "query is required.",
      },

      400,
    );
  }


  let topK =
    5;


  if (
    typeof body.topK ===
      "number" &&
    Number.isFinite(
      body.topK,
    )
  ) {

    topK =
      Math.min(
        Math.max(
          Math.floor(
            body.topK,
          ),

          1,
        ),

        10,
      );
  }


  const context =
    c.get(
      "context",
    );


  const aiProvider =
    resolveAIProvider(
      c.env.AI,
    );


  const result =
    await answerKnowledgeQuestion(
      aiProvider,

      c.env.AI,

      c.env.VECTORIZE_V2,

      context.tenant.id,

      query,

      topK,
    );


  return c.json({
    success:
      true,

    answer:
      result.answer,

    grounded:
      result.grounded,

    query:
      result.query,

    tenantId:
      result.tenantId,

    sources:
      result.sources,
  });
}
import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  searchKnowledgeForTenant,
} from "./retrieval-service";


interface KnowledgeSearchRequest {

  query?:
    unknown;

  topK?:
    unknown;
}


export async function searchKnowledgeController(
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
      KnowledgeSearchRequest
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

        20,
      );
  }


  const context =
    c.get(
      "context",
    );


  const result =
    await searchKnowledgeForTenant(
      c.env.AI,

      c.env.VECTORIZE,

      context.tenant.id,

      query,

      topK,
    );


  return c.json({
    success:
      true,

    search:
      result,
  });
}
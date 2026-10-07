import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  indexKnowledgeForTenant,
} from "./indexing-service";


export async function indexKnowledgeController(
  c:
    Context<{
      Bindings:
        AppBindings;

      Variables:
        AppVariables;
    }>,
) {

  const context =
    c.get(
      "context",
    );


  const result =
    await indexKnowledgeForTenant(
      c.env.DB,

      c.env.AI,

      c.env.VECTORIZE,

      context.tenant.id,
    );


  return c.json({
    success:
      true,

    index:
      result,
  });
}
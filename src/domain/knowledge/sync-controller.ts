import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  syncKnowledgeBase,
} from "./sync-service";


type KnowledgeContext =
  Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>;


export async function syncKnowledgeBaseController(
  c:
    KnowledgeContext,
) {

  const context =
    c.get(
      "context",
    );


  const knowledgeBaseId =
    c.req.param(
      "knowledgeBaseId",
    );


  if (
    !knowledgeBaseId
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "knowledgeBaseId is required.",
      },

      400,
    );
  }


  const result =
    await syncKnowledgeBase(
      c.env.DB,
      context,
      knowledgeBaseId,
    );


  return c.json({
    success:
      true,

    provider:
      context
        .tenant
        .integrations
        .crm
        .provider,

    sync:
      result,
  });
}
import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  getKnowledgeBases,
  getKnowledgeDocuments,
} from "./service";


type KnowledgeContext =
  Context<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>;


export async function getKnowledgeBasesController(
  c:
    KnowledgeContext,
) {

  const context =
    c.get(
      "context",
    );


  const knowledgeBases =
    await getKnowledgeBases(
      context,
    );


  return c.json({
    success:
      true,

    provider:
      "gohighlevel",

    count:
      knowledgeBases.length,

    knowledgeBases,
  });
}


export async function getKnowledgeDocumentsController(
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


  const documents =
    await getKnowledgeDocuments(
      context,
      knowledgeBaseId,
    );


  return c.json({
    success:
      true,

    provider:
      "gohighlevel",

    knowledgeBaseId,

    count:
      documents.length,

    documents,
  });
}
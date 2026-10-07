import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  getKnowledgeBasesController,
  getKnowledgeDocumentsController,
} from "./controller";

import {
  syncKnowledgeBaseController,
} from "./sync-controller";

import {
  indexKnowledgeController,
} from "./index-controller";

import {
  searchKnowledgeController,
} from "./retrieval-controller";

import {
  answerKnowledgeController,
} from "./answer-controller";


const knowledgeRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


/*
 * --------------------------------------------------
 * GoHighLevel Knowledge Base
 * --------------------------------------------------
 */

knowledgeRoutes.get(
  "/gohighlevel/bases",
  getKnowledgeBasesController,
);


knowledgeRoutes.get(
  "/gohighlevel/bases/:knowledgeBaseId/documents",
  getKnowledgeDocumentsController,
);


knowledgeRoutes.post(
  "/gohighlevel/bases/:knowledgeBaseId/sync",
  syncKnowledgeBaseController,
);


/*
 * --------------------------------------------------
 * Knowledge Vector Index
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/index",
  indexKnowledgeController,
);


/*
 * --------------------------------------------------
 * Knowledge Vector Search
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/search",
  searchKnowledgeController,
);


/*
 * --------------------------------------------------
 * Knowledge RAG Answer
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/answer",
  answerKnowledgeController,
);


export default knowledgeRoutes;
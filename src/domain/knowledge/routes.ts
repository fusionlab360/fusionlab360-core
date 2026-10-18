import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

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
  requirePermission("knowledge:read"),
  getKnowledgeBasesController,
);


knowledgeRoutes.get(
  "/gohighlevel/bases/:knowledgeBaseId/documents",
  requirePermission("knowledge:read"),
  getKnowledgeDocumentsController,
);


knowledgeRoutes.post(
  "/gohighlevel/bases/:knowledgeBaseId/sync",
  requirePermission("knowledge:write"),
  syncKnowledgeBaseController,
);


/*
 * --------------------------------------------------
 * Knowledge Vector Index
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/index",
  requirePermission("knowledge:write"),
  indexKnowledgeController,
);


/*
 * --------------------------------------------------
 * Knowledge Vector Search
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/search",
  requirePermission("knowledge:read"),
  searchKnowledgeController,
);


/*
 * --------------------------------------------------
 * Knowledge RAG Answer
 * --------------------------------------------------
 */

knowledgeRoutes.post(
  "/answer",
  requirePermission("knowledge:answer"),
  answerKnowledgeController,
);


export default knowledgeRoutes;

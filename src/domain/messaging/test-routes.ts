import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  testGetConversationController,
  testSendMessageController,
} from "./test-controller";

const messagingTestRoutes =
  new Hono<{
    Bindings: AppBindings;
    Variables: AppVariables;
  }>();

messagingTestRoutes.get(
  "/conversations/:conversationId/messages",
  requirePermission("messaging:test"),
  testGetConversationController,
);

messagingTestRoutes.post(
  "/conversations/:conversationId/reply",
  requirePermission("messaging:test"),
  testSendMessageController,
);

export default messagingTestRoutes;

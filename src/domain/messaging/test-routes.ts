import { Hono } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

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
  testGetConversationController,
);

messagingTestRoutes.post(
  "/conversations/:conversationId/reply",
  testSendMessageController,
);

export default messagingTestRoutes;
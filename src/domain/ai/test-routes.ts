import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  testAIController,
} from "./test-controller";

import {
  testAISessionController,
} from "./session-test-controller";


const aiTestRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


aiTestRoutes.post(
  "/chat",
  requirePermission("ai:test"),
  testAIController,
);


aiTestRoutes.post(
  "/session",
  requirePermission("ai:test"),
  testAISessionController,
);


export default aiTestRoutes;

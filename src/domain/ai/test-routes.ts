import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

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
  testAIController,
);


aiTestRoutes.post(
  "/session",
  testAISessionController,
);


export default aiTestRoutes;
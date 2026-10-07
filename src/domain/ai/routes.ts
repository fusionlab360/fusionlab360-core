import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  getAIProfile,
  updateAIProfile,
} from "./controller";


const aiRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


/**
 * AI Agent Profile
 */
aiRoutes.get(
  "/profile",
  getAIProfile,
);

aiRoutes.put(
  "/profile",
  updateAIProfile,
);


export default aiRoutes;
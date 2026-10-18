import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

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
  requirePermission("ai:read"),
  getAIProfile,
);

aiRoutes.put(
  "/profile",
  requirePermission("ai:write"),
  updateAIProfile,
);


export default aiRoutes;

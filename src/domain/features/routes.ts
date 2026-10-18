import { Hono } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  getTenantFeatures,
  updateTenantFeature,
} from "./controller";

const featureRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

featureRoutes.get("/", requirePermission("features:read"), getTenantFeatures);
featureRoutes.patch("/:featureKey", requirePermission("features:write"), updateTenantFeature);

export default featureRoutes;

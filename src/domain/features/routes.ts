import { Hono } from "hono";
import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  getTenantFeatures,
  updateTenantFeature,
} from "./controller";

const featureRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

featureRoutes.get("/", getTenantFeatures);
featureRoutes.patch("/:featureKey", updateTenantFeature);

export default featureRoutes;
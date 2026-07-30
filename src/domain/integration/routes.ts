import { Hono } from "hono";

import type { AppBindings } from "../../config/app";

import { discoverIntegrationController } from "./controller";

const integrationRoutes = new Hono<{
  Bindings: AppBindings;
}>();

integrationRoutes.post(
  "/discover",
  discoverIntegrationController
);

export default integrationRoutes;
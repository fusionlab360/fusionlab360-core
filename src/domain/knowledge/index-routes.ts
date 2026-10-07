import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  indexKnowledgeController,
} from "./index-controller";


const indexRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


indexRoutes.post(
  "/",
  indexKnowledgeController,
);


export default indexRoutes;
import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  ghlOAuthCallbackController,
} from "./oauth-controller";


const oauthRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


oauthRoutes.get(
  "/gohighlevel/callback",
  ghlOAuthCallbackController,
);


export default oauthRoutes;
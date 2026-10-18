import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  ghlOAuthCallbackController,
  startGhlOAuthController,
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

oauthRoutes.post(
  "/gohighlevel/authorize",
  startGhlOAuthController,
);


export default oauthRoutes;

import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  ghlInboundMessageController,
} from "./webhook-controller";


const messagingRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


messagingRoutes.post(
  "/inbound",
  ghlInboundMessageController,
);


export default messagingRoutes;
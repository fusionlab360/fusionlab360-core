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
import { ghlProviderOutboundController } from "../../integrations/messaging/gohighlevel/provider-outbound";


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

messagingRoutes.post(
  "/provider-outbound",
  ghlProviderOutboundController,
);


export default messagingRoutes;

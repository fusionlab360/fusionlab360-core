import { Hono } from "hono";
import type { AppBindings } from "../../config/app";

import { processReservationController } from "./controller";

const reservationRoutes = new Hono<{
  Bindings: AppBindings;
}>();

reservationRoutes.post("/sync", processReservationController);

export default reservationRoutes;
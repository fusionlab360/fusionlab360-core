import { Hono } from "hono";
import type { AppBindings } from "../../config/app";
import type { AppVariables } from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  processReservationController,
} from "./controller";


const reservationRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();


reservationRoutes.post(
  "/sync",
  requirePermission("reservations:sync"),
  processReservationController,
);


export default reservationRoutes;

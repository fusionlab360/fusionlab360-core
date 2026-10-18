import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import {
  listBookingOfferingsController,
  getBookingAvailabilityController,
  createBookingController,
  getAccommodationBookingPageController,
} from "./controller";

import {
  testBookingIntentController,
} from "./intent-controller";

import {
  testAIBookingController,
} from "./ai-booking-controller";

import { createMiddleware } from "hono/factory";


export const bookingTestRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

bookingTestRoutes.post(
  "/intent-test",
  requirePermission("booking:test"),
  testBookingIntentController,
);

bookingTestRoutes.post(
  "/ai-test",
  requirePermission("booking:test"),
  testAIBookingController,
);



const bookingRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();

bookingRoutes.get(
  "/accommodation/booking-page",
  requirePermission("booking:read"),
  getAccommodationBookingPageController,
);

bookingRoutes.get(
  "/offerings",
  requirePermission("booking:read"),
  listBookingOfferingsController,
);


bookingRoutes.post(
  "/availability",
  requirePermission("booking:read"),
  getBookingAvailabilityController,
);


bookingRoutes.post(
  "/",
  requirePermission("booking:create"),
  createBookingController,
);

export default bookingRoutes;

const testRouteEnvironmentMiddleware = createMiddleware<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>(async (c, next) => {
  const environment = c.env.APP_ENVIRONMENT;

  if (
    environment !== "development" &&
    environment !== "staging"
  ) {
    return c.json(
      {
        success: false,
        message: "Not Found",
      },
      404,
    );
  }

  await next();
});

bookingRoutes.use(
  "/intent-test",
  testRouteEnvironmentMiddleware,
);

bookingRoutes.use(
  "/ai-test",
  testRouteEnvironmentMiddleware,
);
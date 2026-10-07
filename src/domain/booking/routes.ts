import {
  Hono,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  listBookingOfferingsController,
  getBookingAvailabilityController,
  createBookingController,
} from "./controller";

import {
  testBookingIntentController,
} from "./intent-controller";

import {
  testAIBookingController,
} from "./ai-booking-controller";


const bookingRoutes =
  new Hono<{
    Bindings:
      AppBindings;

    Variables:
      AppVariables;
  }>();


bookingRoutes.get(
  "/offerings",
  listBookingOfferingsController,
);


bookingRoutes.post(
  "/availability",
  getBookingAvailabilityController,
);


bookingRoutes.post(
  "/",
  createBookingController,
);

bookingRoutes.post(
  "/intent-test",
  testBookingIntentController,
);

bookingRoutes.post(
  "/ai-test",
  testAIBookingController,
);

export default bookingRoutes;
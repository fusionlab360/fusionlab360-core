import type {
  Context,
} from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  createIntegrationContext,
} from "../../context/integration";

import type {
  BookingType,
  BookingAvailabilityRequest,
  CreateBookingRequest,
} from "../../core/booking";

import {
  listBookingOfferings,
  getBookingAvailability,
  createBooking,
} from "./service";


type BookingContext = Context<{
  Bindings:
    AppBindings;

  Variables:
    AppVariables;
}>;


function getIntegrationContext(
  c:
    BookingContext,
) {

  const requestContext =
    c.get(
      "context",
    );


  return createIntegrationContext(
  requestContext.tenant,

  requestContext
    .tenant
    .integrations
    .crm
    .provider,

  requestContext.integrationRuntime,
);
}


/*
 * --------------------------------------------------
 * GET /booking/offerings
 * --------------------------------------------------
 *
 * Example:
 *
 * GET /booking/offerings?type=appointment
 */
export async function listBookingOfferingsController(
  c:
    BookingContext,
) {

  const type =
    c.req.query(
      "type",
    ) as BookingType | undefined;


  if (
    type !==
      "appointment" &&

    type !==
      "accommodation"
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "type must be appointment or accommodation.",
      },

      400,
    );
  }


  const context =
    getIntegrationContext(
      c,
    );


  const offerings =
    await listBookingOfferings(
      context,

      type,
    );


  return c.json({

    success:
      true,

    type,

    offerings,
  });
}


/*
 * --------------------------------------------------
 * POST /booking/availability
 * --------------------------------------------------
 */
export async function getBookingAvailabilityController(
  c:
    BookingContext,
) {

  const body =
    await c.req.json<
      BookingAvailabilityRequest
    >();


  if (
    body.type !==
      "appointment" &&

    body.type !==
      "accommodation"
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "type must be appointment or accommodation.",
      },

      400,
    );
  }


  if (
    !body.offeringId?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "offeringId is required.",
      },

      400,
    );
  }


  if (
    !body.start?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "start is required.",
      },

      400,
    );
  }


  if (
    !body.end?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "end is required.",
      },

      400,
    );
  }


  const context =
    getIntegrationContext(
      c,
    );


  const slots =
    await getBookingAvailability(
      context,

      body,
    );


  return c.json({

    success:
      true,

    request:
      body,

    slots,
  });
}


/*
 * --------------------------------------------------
 * POST /booking
 * --------------------------------------------------
 */
export async function createBookingController(
  c:
    BookingContext,
) {

  const body =
    await c.req.json<
      CreateBookingRequest
    >();


  if (
    body.type !==
      "appointment" &&

    body.type !==
      "accommodation"
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "type must be appointment or accommodation.",
      },

      400,
    );
  }


  if (
    !body.offeringId?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "offeringId is required.",
      },

      400,
    );
  }


  if (
    !body.customerId?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "customerId is required.",
      },

      400,
    );
  }


  if (
    !body.start?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "start is required.",
      },

      400,
    );
  }


  if (
    !body.end?.trim()
  ) {

    return c.json(
      {
        success:
          false,

        message:
          "end is required.",
      },

      400,
    );
  }


  const context =
    getIntegrationContext(
      c,
    );


  const booking =
    await createBooking(
      context,

      body,
    );


  return c.json({

    success:
      true,

    booking,
  });
}
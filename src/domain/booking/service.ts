import type {
  IntegrationContext,
} from "../../context/integration";

import {
  resolveBookingProvider,
} from "../../core/booking";

import type {
  BookingType,
  BookingAvailabilityRequest,
  CreateBookingRequest,
} from "../../core/booking";


export async function listBookingOfferings(
  context:
    IntegrationContext,

  type:
    BookingType,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  return provider.listOfferings(
    context,

    type,
  );
}


export async function getBookingAvailability(
  context:
    IntegrationContext,

  request:
    BookingAvailabilityRequest,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  return provider.getAvailability(
    context,

    request,
  );
}


export async function createBooking(
  context:
    IntegrationContext,

  request:
    CreateBookingRequest,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  return provider.createBooking(
    context,

    request,
  );
}

export async function getBooking(
  context:
    IntegrationContext,

  bookingId:
    string,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  if (
    !provider.getBooking
  ) {

    throw new Error(
      "The configured booking provider does not support retrieving bookings.",
    );
  }


  return provider.getBooking(
    context,

    bookingId,
  );
}


export async function updateBooking(
  context:
    IntegrationContext,

  bookingId:
    string,

  request:
    Partial<
      CreateBookingRequest
    >,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  if (
    !provider.updateBooking
  ) {

    throw new Error(
      "The configured booking provider does not support updating bookings.",
    );
  }


  return provider.updateBooking(
    context,

    bookingId,

    request,
  );
}


export async function cancelBooking(
  context:
    IntegrationContext,

  bookingId:
    string,
) {

  const provider =
    resolveBookingProvider(
      context,
    );


  if (
    !provider.cancelBooking
  ) {

    throw new Error(
      "The configured booking provider does not support cancelling bookings.",
    );
  }


  return provider.cancelBooking(
    context,

    bookingId,
  );
}
import type {
  IntegrationContext,
} from "../../context/integration";

import type {
  BookingProvider,
} from "./contracts";

import {
  goHighLevelBookingProvider,
} from "../../integrations/booking/gohighlevel/provider";


/*
 * --------------------------------------------------
 * Booking provider registry
 * --------------------------------------------------
 *
 * The resolver remains provider-neutral.
 *
 * Clinic:
 *   gohighlevel
 *
 * Future Hotel:
 *   pms / channel-manager provider can be registered
 *   here without changing the booking domain logic.
 *
 * Do not add a provider here until its adapter actually
 * exists.
 * --------------------------------------------------
 */

const BOOKING_PROVIDERS:
  Record<
    string,
    BookingProvider
  > = {

  gohighlevel:
    goHighLevelBookingProvider,
};


/*
 * --------------------------------------------------
 * Resolve booking provider
 * --------------------------------------------------
 */

export function resolveBookingProvider(
  context:
    IntegrationContext,
): BookingProvider {

  const provider =
    BOOKING_PROVIDERS[
      context.provider
    ];


  if (
    !provider
  ) {

    throw new Error(
      `Unsupported booking provider: ${context.provider}`,
    );
  }


  return provider;
}
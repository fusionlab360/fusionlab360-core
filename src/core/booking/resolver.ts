import type {
  IntegrationContext,
} from "../../context/integration";

import type {
  BookingProvider,
} from "./contracts";

import {
  goHighLevelBookingProvider,
} from "../../integrations/booking/gohighlevel/provider";


export function resolveBookingProvider(
  context:
    IntegrationContext,
): BookingProvider {

  switch (
    context.provider
  ) {

    case "gohighlevel":
      return goHighLevelBookingProvider;

    default:
      throw new Error(
        `Unsupported booking provider: ${context.provider}`,
      );
  }
}
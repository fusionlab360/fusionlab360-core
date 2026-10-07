import type { RequestContext } from "../../context";

import type {
  PMSAdapter,
} from "./contracts";

import {
  ABSHotelAdapter,
} from "../../integrations/pms/abs-hotel";


export function resolvePMSAdapter(
  _context: RequestContext,
  provider: string,
): PMSAdapter {

  switch (
    provider
      .trim()
      .toLowerCase()
  ) {

    case "abs-hotel":

      return new ABSHotelAdapter();

    default:

      throw new Error(
        `Unsupported PMS provider: ${provider}`,
      );

  }

}
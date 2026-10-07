import type {
  MessagingProvider,
} from "./contracts";

import {
  goHighLevelMessagingProvider,
} from "../../integrations/messaging/gohighlevel/provider";

export function resolveMessagingProvider(
  provider: string,
): MessagingProvider {

  switch (provider) {

    case "gohighlevel":
      return goHighLevelMessagingProvider;

    default:
      throw new Error(
        `Unsupported messaging provider: ${provider}`,
      );
  }
}
import type {
  KnowledgeProvider,
} from "./contracts";

import {
  ApiError,
} from "../errors/ApiError";

import {
  goHighLevelKnowledgeProvider,
} from "../../integrations/knowledge/gohighlevel/provider";


export function resolveKnowledgeProvider(
  provider:
    string,
): KnowledgeProvider {

  switch (
    provider
  ) {

    case "gohighlevel":
      return goHighLevelKnowledgeProvider;

    default:
      throw new ApiError(
        501,
        `Knowledge provider is not implemented: ${provider}`,
      );
  }
}
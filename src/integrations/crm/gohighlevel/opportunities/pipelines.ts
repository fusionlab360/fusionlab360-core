import type { RequestContext } from "../../../../context";
import { ghlFetchAuthenticated } from "../client";
import { GHL } from "../config";
import type { GHLStage } from "../types";

export interface GHLPipeline {
  id: string;
  name: string;
  stages?: GHLStage[];
}

export function getPipelines(
  context: RequestContext,
  locationId: string,
) {
  return ghlFetchAuthenticated<{
    pipelines: GHLPipeline[];
  }>(
    context,
    `${GHL.ENDPOINTS.PIPELINES}?locationId=${encodeURIComponent(
      locationId,
    )}`,
  );
}
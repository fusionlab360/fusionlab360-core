import type { RequestContext } from "../../../../context";
import { ghlFetchAuthenticated } from "../client";
import { GHL } from "../config";

export interface GHLStage {
  id: string;
  name: string;
}

export function getPipelineStages(
  context: RequestContext,
  pipelineId: string,
) {
  return ghlFetchAuthenticated<{
    stages: GHLStage[];
  }>(
    context,
    `${GHL.ENDPOINTS.PIPELINES}/${encodeURIComponent(
      pipelineId,
    )}`,
  );
}
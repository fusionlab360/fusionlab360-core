import { ghlFetch } from "../client";
import { GHL } from "../config";

export interface GHLStage {
  id: string;
  name: string;
}

export function getPipelineStages(
  apiKey: string,
  pipelineId: string
) {
  return ghlFetch<{
    stages: GHLStage[];
  }>(
    apiKey,
    `${GHL.ENDPOINTS.PIPELINES}/${pipelineId}`
  );
}
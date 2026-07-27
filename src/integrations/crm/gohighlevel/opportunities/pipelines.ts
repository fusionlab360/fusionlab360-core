import { ghlFetch } from "../client";
import { GHL } from "../config";

export interface GHLPipeline {
  id: string;
  name: string;
}

export function getPipelines(
  apiKey: string,
  locationId: string
) {
  return ghlFetch<{
    pipelines: GHLPipeline[];
  }>(
    apiKey,
    `${GHL.ENDPOINTS.PIPELINES}?locationId=${encodeURIComponent(locationId)}`
  );
}
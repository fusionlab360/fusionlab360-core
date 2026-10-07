import type { RequestContext } from "../../context";
import type { IntegrationConfiguration } from "../../persistence/models/integration-configuration";

export interface CRMPreviewResult {
  provider: string;
  locationId: string;
  pipelines: {
    id: string;
    name: string;
  }[];
    stages: number;
    customFields: number;
}

export interface CRMOnboarding {

  preview(
    apiKey: string,
    locationId: string,
  ): Promise<CRMPreviewResult>;

  configure(
    apiKey: string,
    locationId: string,
    pipelineId: string,
    providerOptions?: Record<string, unknown>,
  ): Promise<IntegrationConfiguration>;
}